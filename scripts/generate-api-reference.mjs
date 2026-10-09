#!/usr/bin/env node
/**
 * Generate Developer documentation without importing the API or connecting to services.
 * Registration, validators, permissions and response envelopes are read using the
 * TypeScript compiler AST. Unknown runtime shapes are explicitly left unknown.
 * Run: node scripts/generate-api-reference.mjs [--check]
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "apps/api/package.json"));
const ts = require("typescript");
const appPath = path.join(root, "apps/api/src/app.ts");
const outputPath = path.join(root, "apps/admin/src/content/developer-api-reference.json");
const program = ts.createProgram([appPath], {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  skipLibCheck: true,
  noEmit: true,
});
const checker = program.getTypeChecker();
const app = program.getSourceFile(appPath);
const failures = [];
const unresolved = new Set();
const methods = new Set(["get", "post", "patch", "put", "delete", "head", "options"]);
const sensitive =
  /password|secret|token|ticket|sessionId|api.?key|authorization|cookie|gift.?card.?code|credentials/i;
const rel = (node) => path.relative(root, node.getSourceFile().fileName).replaceAll(path.sep, "/");
const location = (node) => ({
  file: rel(node),
  line: node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1,
});
const clone = (value) => structuredClone(value);
const text = (node, max = 2000) => node?.getText().replace(/\s+/g, " ").slice(0, max) ?? "";
function walk(node, callback) {
  if (!node) return;
  callback(node);
  ts.forEachChild(node, (child) => walk(child, callback));
}
function unwrap(node) {
  while (
    node &&
    (ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isSatisfiesExpression(node))
  )
    node = node.expression;
  return node;
}
function name(node) {
  return ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)
    ? node.text
    : text(node);
}
function declaration(node) {
  node = unwrap(node);
  if (!node) return undefined;
  let symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(node) ? node.name : node);
  if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  return symbol?.valueDeclaration ?? symbol?.declarations?.[0];
}
function initializer(node) {
  const decl = declaration(node);
  if (decl && ts.isVariableDeclaration(decl)) return decl.initializer;
  if (decl && ts.isPropertyAssignment(decl)) return decl.initializer;
  return undefined;
}
function literal(node, seen = new Set()) {
  node = unwrap(node);
  if (!node || seen.has(node)) return undefined;
  seen = new Set(seen).add(node);
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken)
    return -literal(node.operand, seen);
  if (ts.isArrayLiteralExpression(node)) return node.elements.map((item) => literal(item, seen));
  if (ts.isTemplateExpression(node)) {
    let value = node.head.text;
    for (const span of node.templateSpans) {
      const part = literal(span.expression, seen);
      if (part === undefined) return undefined;
      value += String(part) + span.literal.text;
    }
    return value;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = literal(node.left, seen);
    const right = literal(node.right, seen);
    if (left !== undefined && right !== undefined) return left + right;
  }
  if (ts.isObjectLiteralExpression(node))
    return Object.fromEntries(
      node.properties
        .filter(ts.isPropertyAssignment)
        .map((property) => [name(property.name), literal(property.initializer, seen)]),
    );
  if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
    const init = initializer(node);
    if (init) return literal(init, seen);
  }
  return undefined;
}
function objectProperties(node) {
  node = unwrap(node);
  if (!node) return [];
  if (!ts.isObjectLiteralExpression(node)) return objectProperties(initializer(node));
  return node.properties.flatMap((property) =>
    ts.isSpreadAssignment(property) ? objectProperties(property.expression) : [property],
  );
}
function property(node, key) {
  const item = objectProperties(node).find((item) => item.name && name(item.name) === key);
  return (
    item &&
    (ts.isPropertyAssignment(item)
      ? item.initializer
      : ts.isShorthandPropertyAssignment(item)
        ? item.name
        : undefined)
  );
}
function placeholder(field = "value", schema = {}) {
  if (sensitive.test(field)) return `<${field}>`;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum?.length) return schema.enum[0];
  if (schema.type === "object")
    return Object.fromEntries(
      (schema.fields ?? [])
        .filter((item) => item.required || item.default !== undefined)
        .map((item) => [item.name, placeholder(item.name, item)]),
    );
  if (schema.type === "array") return [placeholder(field, schema.items ?? {})];
  if (schema.type === "boolean") return true;
  if (schema.type === "number" || schema.type === "integer") return 1;
  if (schema.type === "union") return placeholder(field, schema.alternatives?.[0] ?? {});
  if (schema.type === "null") return null;
  if (/email/i.test(field)) return "member@example.com";
  if (/date|at$/i.test(field) || schema.constraints?.some((item) => item.startsWith("datetime")))
    return "2030-01-01T00:00:00.000Z";
  if (schema.constraints?.some((item) => item.startsWith("url"))) return "https://example.com";
  return `<${field}>`;
}
function finishSchema(schema, node, field) {
  schema.validator = text(node);
  if (sensitive.test(field ?? "")) {
    if (schema.default !== undefined) schema.default = `<${field}>`;
    if (schema.enum) schema.enum = schema.enum.map(() => `<${field}>`);
  }
  schema.example = placeholder(field, schema);
  return schema;
}
function schemaFromType(node, field = "value", seen = new Set()) {
  if (!node || seen.has(node)) return { type: "unknown", required: false };
  seen = new Set(seen).add(node);
  if (ts.isTypeLiteralNode(node))
    return {
      type: "object",
      required: true,
      fields: node.members.filter(ts.isPropertySignature).map((member) => ({
        name: name(member.name),
        ...schemaFromType(member.type, name(member.name), seen),
        required: !member.questionToken,
      })),
    };
  if (ts.isArrayTypeNode(node))
    return { type: "array", required: true, items: schemaFromType(node.elementType, field, seen) };
  if (ts.isLiteralTypeNode(node)) {
    const value = literal(node.literal);
    return { type: typeof value, required: true, enum: [value] };
  }
  if (ts.isUnionTypeNode(node)) {
    const alternatives = node.types.map((item) => schemaFromType(item, field, seen));
    return {
      type: "union",
      required: !node.types.some((item) => item.kind === ts.SyntaxKind.UndefinedKeyword),
      alternatives,
    };
  }
  const primitive = new Map([
    [ts.SyntaxKind.StringKeyword, "string"],
    [ts.SyntaxKind.NumberKeyword, "number"],
    [ts.SyntaxKind.BooleanKeyword, "boolean"],
    [ts.SyntaxKind.UnknownKeyword, "unknown"],
  ]);
  if (primitive.has(node.kind)) return { type: primitive.get(node.kind), required: true };
  return { type: "unknown", required: true, validator: text(node) };
}
function schema(node, field = "value", seen = new Set()) {
  node = unwrap(node);
  if (!node || seen.has(node))
    return {
      type: "unknown",
      required: true,
      validator: text(node),
      constraints: ["Recursive or unresolved schema; consult the source validator."],
    };
  seen = new Set(seen).add(node);
  if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
    const init = initializer(node);
    if (init) return finishSchema(schema(init, field, seen), node, field);
    unresolved.add(`${rel(node)}:${text(node)}`);
    return finishSchema({ type: "unknown", required: true }, node, field);
  }
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression))
    return finishSchema({ type: "unknown", required: true }, node, field);
  const operation = node.expression.name.text;
  const baseNode = node.expression.expression;
  const baseText = text(baseNode);
  const args = node.arguments;
  const factory = baseText === "z" || baseText === "z.coerce" || baseText === "z.ostring";
  let result;
  if (factory) {
    if (operation === "object" || operation === "strictObject")
      result = {
        type: "object",
        required: true,
        fields: objectProperties(args[0])
          .filter((item) => item.name)
          .map((item) => ({
            name: name(item.name),
            ...schema(
              ts.isPropertyAssignment(item) ? item.initializer : item.name,
              name(item.name),
              seen,
            ),
          })),
      };
    else if (operation === "array")
      result = { type: "array", required: true, items: schema(args[0], field, seen) };
    else if (operation === "enum" || operation === "nativeEnum") {
      let values = literal(args[0]);
      if (values && !Array.isArray(values) && typeof values === "object")
        values = [...new Set(Object.values(values))];
      result = {
        type: "string",
        required: true,
        ...(Array.isArray(values)
          ? { enum: values }
          : { constraints: [`Enum values from ${text(args[0])}; resolve in source.`] }),
      };
    } else if (operation === "literal") {
      const value = literal(args[0]);
      result = { type: value === null ? "null" : typeof value, required: true, enum: [value] };
    } else if (operation === "union" || operation === "discriminatedUnion") {
      const branches = args[operation === "union" ? 0 : 1];
      result = {
        type: "union",
        required: true,
        alternatives: ts.isArrayLiteralExpression(branches)
          ? branches.elements.map((item) => schema(item, field, seen))
          : [],
      };
    } else if (operation === "record")
      result = {
        type: "object",
        required: true,
        constraints: ["Record with dynamic keys"],
        items: schema(args.at(-1), field, seen),
      };
    else if (operation === "lazy") {
      const callback = args[0];
      result = schema(callback?.body, field, seen);
    } else
      result = {
        type: [
          "string",
          "number",
          "boolean",
          "date",
          "null",
          "unknown",
          "any",
          "undefined",
        ].includes(operation)
          ? operation
          : "unknown",
        required: operation !== "undefined",
      };
    if (baseText === "z.coerce")
      result.constraints = [...(result.constraints ?? []), "Input is coerced before validation"];
  } else {
    result = clone(schema(baseNode, field, seen));
    if (operation === "optional" || operation === "default" || operation === "catch")
      result.required = false;
    if (operation === "nullable" || operation === "nullish") result.nullable = true;
    if (operation === "nullish") result.required = false;
    if (operation === "default" || operation === "catch") {
      const value = literal(args[0]);
      if (value !== undefined) result.default = value;
    }
    if (["partial", "deepPartial", "required"].includes(operation) && result.fields) {
      const keys = literal(args[0]);
      result.fields = result.fields.map((item) =>
        !keys || keys[item.name]
          ? { ...item, required: operation === "required" && item.default === undefined }
          : item,
      );
    }
    if (["pick", "omit"].includes(operation) && result.fields) {
      const keys = literal(args[0]) ?? {};
      result.fields = result.fields.filter((item) =>
        operation === "pick" ? keys[item.name] : !keys[item.name],
      );
    }
    if (["extend", "merge", "and"].includes(operation)) {
      const extra =
        operation === "extend"
          ? {
              fields: objectProperties(args[0])
                .filter((item) => item.name)
                .map((item) => ({
                  name: name(item.name),
                  ...schema(
                    ts.isPropertyAssignment(item) ? item.initializer : item.name,
                    name(item.name),
                    seen,
                  ),
                })),
            }
          : schema(args[0], field, seen);
      result.fields = [
        ...new Map(
          [...(result.fields ?? []), ...(extra.fields ?? [])].map((item) => [item.name, item]),
        ).values(),
      ];
    }
    if (operation === "array") result = { type: "array", required: true, items: result };
    if (operation === "or")
      result = {
        type: "union",
        required: true,
        alternatives: [result, schema(args[0], field, seen)],
      };
    if (operation === "int") result.type = "integer";
    if (
      ![
        "optional",
        "nullable",
        "nullish",
        "default",
        "catch",
        "partial",
        "deepPartial",
        "required",
        "pick",
        "omit",
        "extend",
        "merge",
        "array",
        "or",
      ].includes(operation)
    ) {
      const parameters = args.map((argument) => {
        const value = literal(argument);
        return value !== undefined
          ? JSON.stringify(value)
          : ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)
            ? "custom validation/transformation in source"
            : text(argument, 120);
      });
      result.constraints = [
        ...(result.constraints ?? []),
        `${operation}${parameters.length ? `(${parameters.join(", ")})` : ""}`,
      ];
    }
  }
  return finishSchema(result, node, field);
}

// Interpret only the pure permission selector's small expression vocabulary;
// never execute imported application code or route handlers.
function evaluate(node, env) {
  node = unwrap(node);
  if (!node) return undefined;
  if (ts.isIdentifier(node)) return env[node.text];
  if (ts.isRegularExpressionLiteral(node)) {
    const pattern = node.text.match(/^\/(.*)\/([a-z]*)$/s);
    return pattern ? new RegExp(pattern[1], pattern[2]) : undefined;
  }
  if (ts.isConditionalExpression(node))
    return evaluate(evaluate(node.condition, env) ? node.whenTrue : node.whenFalse, env);
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken)
    return !evaluate(node.operand, env);
  if (ts.isElementAccessExpression(node))
    return evaluate(node.expression, env)?.[evaluate(node.argumentExpression, env)];
  if (ts.isBinaryExpression(node)) {
    const left = evaluate(node.left, env);
    const op = node.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) return left && evaluate(node.right, env);
    if (op === ts.SyntaxKind.BarBarToken) return left || evaluate(node.right, env);
    if (op === ts.SyntaxKind.QuestionQuestionToken) return left ?? evaluate(node.right, env);
    const right = evaluate(node.right, env);
    if (op === ts.SyntaxKind.EqualsEqualsEqualsToken) return left === right;
    if (op === ts.SyntaxKind.ExclamationEqualsEqualsToken) return left !== right;
    if (op === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left))
      return (env[node.left.text] = right);
  }
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const receiver = evaluate(node.expression.expression, env);
    const method = node.expression.name.text;
    if (
      ["startsWith", "endsWith", "includes", "split", "test"].includes(method) &&
      receiver != null
    )
      return receiver[method](...node.arguments.map((item) => evaluate(item, env)));
  }
  return literal(node);
}
function executeStatements(statements, env) {
  for (const statement of statements) {
    if (ts.isReturnStatement(statement))
      return { returned: true, value: evaluate(statement.expression, env) };
    if (ts.isVariableStatement(statement))
      for (const item of statement.declarationList.declarations)
        if (ts.isIdentifier(item.name)) env[item.name.text] = evaluate(item.initializer, env);
    if (ts.isExpressionStatement(statement)) evaluate(statement.expression, env);
    if (ts.isIfStatement(statement) && evaluate(statement.expression, env)) {
      const branch = statement.thenStatement;
      const result = executeStatements(ts.isBlock(branch) ? branch.statements : [branch], env);
      if (result.returned) return result;
    }
  }
  return { returned: false };
}
const permissionsPath = path.join(root, "apps/api/src/lib/permissions.ts");
const permissionsFile = program.getSourceFile(permissionsPath);
const selector = permissionsFile.statements.find(
  (item) => ts.isFunctionDeclaration(item) && item.name?.text === "capabilityForAdminRequest",
);
if (!selector?.body)
  throw new Error(
    "Cannot resolve capabilityForAdminRequest; permission documentation cannot be generated safely.",
  );
function capability(method, url) {
  return (
    executeStatements(selector.body.statements, { method, url: url.replace(/:[^/]+/g, "example") })
      .value ?? null
  );
}

function requestKind(node, requestName) {
  let found;
  walk(node, (item) => {
    if (
      ts.isPropertyAccessExpression(item) &&
      ts.isIdentifier(item.expression) &&
      item.expression.text === requestName &&
      ["body", "params", "query", "headers"].includes(item.name.text)
    )
      found ??= item.name.text;
  });
  return found;
}
function functionNode(expression) {
  expression = unwrap(expression);
  if (!expression) return undefined;
  if (
    ts.isArrowFunction(expression) ||
    ts.isFunctionExpression(expression) ||
    ts.isFunctionDeclaration(expression)
  )
    return expression;
  const owner = declaration(expression);
  if (owner && ts.isFunctionDeclaration(owner)) return owner;
  if (owner && ts.isVariableDeclaration(owner)) return functionNode(owner.initializer);
  return undefined;
}
function resolveHandler(expression, seen = new Set()) {
  expression = unwrap(expression);
  if (!expression || seen.has(expression)) return undefined;
  seen = new Set(seen).add(expression);
  if (ts.isCallExpression(expression)) {
    const factory = functionNode(expression.expression);
    if (!factory?.body) return undefined;
    if (!ts.isBlock(factory.body)) return resolveHandler(factory.body, seen);
    const returns = factory.body.statements.filter(ts.isReturnStatement);
    if (returns.length === 1) return resolveHandler(returns[0].expression, seen);
    return undefined;
  }
  return functionNode(expression);
}
function walkScope(scope, callback) {
  function visit(node) {
    if (
      node !== scope &&
      (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node))
    )
      return;
    callback(node);
    ts.forEachChild(node, visit);
  }
  visit(scope);
}
function conditionalCall(call, scope) {
  for (let current = call.parent; current && current !== scope; current = current.parent) {
    if (
      ts.isIfStatement(current) ||
      ts.isConditionalExpression(current) ||
      ts.isCaseClause(current) ||
      ts.isCatchClause(current)
    )
      return true;
    if (
      ts.isArrowFunction(current) ||
      ts.isFunctionExpression(current) ||
      ts.isFunctionDeclaration(current)
    )
      return true;
  }
  if (scope.body && ts.isBlock(scope.body)) {
    const statements = scope.body.statements;
    const index = statements.findIndex(
      (statement) => call.pos >= statement.pos && call.end <= statement.end,
    );
    for (const statement of statements.slice(0, index)) {
      let earlyReturn = false;
      walkScope(statement, (node) => {
        if (ts.isReturnStatement(node)) earlyReturn = true;
      });
      if (earlyReturn) return true;
    }
  }
  return false;
}
function handlerAndHelpers(handler, requestName) {
  const nodes = [{ node: handler, requestName, conditional: false }];
  const seen = new Set([handler]);
  for (let index = 0; index < nodes.length && index < 30; index++) {
    const scope = nodes[index];
    walkScope(scope.node, (node) => {
      if (
        !ts.isCallExpression(node) ||
        !ts.isIdentifier(node.expression) ||
        !node.arguments.some(
          (arg) =>
            (ts.isIdentifier(arg) && arg.text === scope.requestName) ||
            requestKind(arg, scope.requestName),
        )
      )
        return;
      const decl = functionNode(node.expression);
      if (
        decl &&
        !seen.has(decl) &&
        !rel(decl).includes("node_modules") &&
        rel(decl).startsWith("apps/api/src/")
      ) {
        seen.add(decl);
        const requestIndex = node.arguments.findIndex(
          (arg) =>
            (ts.isIdentifier(arg) && arg.text === scope.requestName) ||
            requestKind(arg, scope.requestName),
        );
        nodes.push({
          node: decl,
          requestName: decl.parameters[requestIndex]?.name?.text ?? "request",
          conditional: scope.conditional || conditionalCall(node, scope.node),
          arguments: node.arguments,
        });
      }
    });
  }
  return nodes;
}
function requestInfo(handler) {
  const requestName = handler?.parameters?.[0]?.name?.text ?? "request";
  const request = { params: [], query: [], body: null, headers: [] };
  const mergeFields = (kind, fields) => {
    request[kind] = [
      ...new Map([...request[kind], ...fields].map((item) => [item.name, item])).values(),
    ];
  };
  const nodes = handlerAndHelpers(handler, requestName);
  for (const { node: scope, requestName } of nodes)
    walkScope(scope, (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ["parse", "safeParse", "parseAsync", "safeParseAsync"].includes(node.expression.name.text)
      ) {
        const kind = requestKind(node.arguments[0], requestName);
        if (!kind || kind === "headers") return;
        const definition = schema(node.expression.expression);
        if (kind === "body") request.body = definition;
        else mergeFields(kind, definition.fields ?? []);
      }
      if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
        const kind = requestKind(node.expression, requestName);
        if (!kind) return;
        const definition = schemaFromType(node.type);
        if (kind === "body" && !request.body) request.body = finishSchema(definition, node.type);
        else if (kind !== "body")
          mergeFields(
            kind,
            (definition.fields ?? []).map((field) => ({
              ...field,
              example: placeholder(field.name, field),
              constraints: ["Type annotation only; validation is performed by handler logic."],
            })),
          );
      }
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isPropertyAccessExpression(unwrap(node.expression))
      ) {
        const inner = unwrap(node.expression);
        if (
          ts.isIdentifier(inner.expression) &&
          inner.expression.text === requestName &&
          ["query", "headers"].includes(inner.name.text)
        ) {
          const kind = inner.name.text;
          if (!request[kind].some((item) => item.name === node.name.text))
            mergeFields(kind, [
              {
                name: node.name.text,
                type: "unknown",
                required: false,
                example: `<${node.name.text}>`,
                constraints: ["Read directly by handler; no source validator extracted."],
              },
            ]);
        }
      }
      if (
        ts.isElementAccessExpression(node) &&
        ts.isPropertyAccessExpression(unwrap(node.expression))
      ) {
        const inner = unwrap(node.expression);
        const key = literal(node.argumentExpression);
        if (
          ts.isIdentifier(inner.expression) &&
          inner.expression.text === requestName &&
          ["query", "headers"].includes(inner.name.text) &&
          typeof key === "string"
        ) {
          const kind = inner.name.text;
          if (!request[kind].some((item) => item.name === key))
            mergeFields(kind, [
              {
                name: key,
                type: "string",
                required: false,
                example: `<${key}>`,
                constraints: ["Read by handler; conditional requirements may apply."],
              },
            ]);
        }
      }
    });
  if (request.body) request.example = request.body.example;
  let directBodyRead = false;
  walk(handler, (node) => {
    if (ts.isPropertyAccessExpression(node) && text(node) === `${requestName}.body`)
      directBodyRead = true;
  });
  if (!request.body && directBodyRead)
    request.body = {
      type: "unknown",
      required: false,
      validator: `${requestName}.body`,
      constraints: ["Body read directly by handler; no complete source validator extracted."],
    };
  // A header read into a local followed by a direct rejection guard is required.
  const aliases = new Map();
  walk(handler, (node) => {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name)) return;
    const value = unwrap(node.initializer);
    if (
      value &&
      ts.isElementAccessExpression(value) &&
      text(value.expression) === `${requestName}.headers`
    )
      aliases.set(node.name.text, literal(value.argumentExpression));
  });
  walk(handler, (node) => {
    if (
      !ts.isIfStatement(node) ||
      !ts.isPrefixUnaryExpression(node.expression) ||
      node.expression.operator !== ts.SyntaxKind.ExclamationToken ||
      !ts.isIdentifier(node.expression.operand)
    )
      return;
    const header = aliases.get(node.expression.operand.text);
    if (
      typeof header !== "string" ||
      !/throw|status\(400\)|code\(400\)/.test(text(node.thenStatement))
    )
      return;
    const field = request.headers.find((item) => item.name === header);
    if (field) field.required = true;
  });
  for (const scope of nodes.filter((item) => !item.conditional)) {
    const headerAliases = new Map();
    walkScope(scope.node, (node) => {
      if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name)) return;
      const value = unwrap(node.initializer);
      if (
        value &&
        ts.isElementAccessExpression(value) &&
        text(value.expression) === `${scope.requestName}.headers`
      )
        headerAliases.set(node.name.text, literal(value.argumentExpression));
    });
    walkScope(scope.node, (node) => {
      if (
        !ts.isIfStatement(node) ||
        !/throw|status\(400\)|code\(400\)/.test(text(node.thenStatement))
      )
        return;
      for (const [alias, header] of headerAliases) {
        let mentioned = false;
        walk(node.expression, (item) => {
          if (ts.isIdentifier(item) && item.text === alias) mentioned = true;
        });
        if (!mentioned) continue;
        const field = request.headers.find((item) => item.name === header);
        if (!field) continue;
        field.required = true;
        field.constraints = [
          ...(field.constraints ?? []),
          `Required by guard in ${rel(scope.node)}:${location(scope.node).line}.`,
        ];
        walk(node.expression, (item) => {
          if (
            ts.isBinaryExpression(item) &&
            item.operatorToken.kind === ts.SyntaxKind.LessThanToken &&
            text(item.left).includes(alias) &&
            /\.length$/.test(text(item.left)) &&
            typeof literal(item.right) === "number"
          )
            field.constraints.push(`min length ${literal(item.right)}`);
        });
      }
    });
  }
  return request;
}
function envelope(node, field = "value", depth = 0) {
  node = unwrap(node);
  if (!node || depth > 5)
    return { type: "unknown", required: true, example: `<${field}: dynamic value>` };
  if (sensitive.test(field)) return { type: "unknown", required: true, example: `<${field}>` };
  if (ts.isObjectLiteralExpression(node)) {
    const fields = node.properties
      .filter((item) => ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item))
      .map((item) => ({
        name: name(item.name),
        ...envelope(
          ts.isPropertyAssignment(item) ? item.initializer : item.name,
          name(item.name),
          depth + 1,
        ),
      }));
    return {
      type: "object",
      required: true,
      fields,
      example: Object.fromEntries(fields.map((item) => [item.name, item.example])),
      ...(node.properties.some(ts.isSpreadAssignment)
        ? { constraints: ["Additional runtime fields are spread into this response."] }
        : {}),
    };
  }
  if (ts.isArrayLiteralExpression(node)) {
    const items = node.elements.map((item) => envelope(item, field, depth + 1));
    return {
      type: "array",
      required: true,
      ...(items[0] ? { items: items[0] } : {}),
      example: items.map((item) => item.example),
    };
  }
  const value = literal(node);
  if (value !== undefined && (value === null || typeof value !== "object"))
    return { type: value === null ? "null" : typeof value, required: true, example: value };
  // Follow local object literals only; DB entities and function results remain unknown.
  const init = ts.isIdentifier(node) ? unwrap(initializer(node)) : undefined;
  if (init && (ts.isObjectLiteralExpression(init) || ts.isArrayLiteralExpression(init)))
    return envelope(init, field, depth + 1);
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    const helper = declaration(node.expression);
    if (
      helper &&
      ts.isFunctionDeclaration(helper) &&
      helper.body &&
      !rel(helper).includes("node_modules")
    ) {
      const returns = helper.body.statements.filter(ts.isReturnStatement);
      const value = returns.length === 1 ? unwrap(returns[0].expression) : undefined;
      if (value && (ts.isObjectLiteralExpression(value) || ts.isArrayLiteralExpression(value)))
        return envelope(value, field, depth + 1);
    }
  }
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "map"
  ) {
    const callback = node.arguments[0];
    const value =
      callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
        ? unwrap(callback.body)
        : undefined;
    if (value && ts.isObjectLiteralExpression(value)) {
      const items = envelope(value, field, depth + 1);
      return { type: "array", required: true, items, example: [items.example] };
    }
  }
  return { type: "unknown", required: true, example: `<${field}: runtime value>` };
}
function responseInfo(handler) {
  const replyName = handler?.parameters?.[1]?.name?.text ?? "reply";
  const result = [];
  const seen = new Set();
  walk(handler, (node) => {
    if (
      !ts.isCallExpression(node) ||
      !ts.isPropertyAccessExpression(node.expression) ||
      !["send", "redirect"].includes(node.expression.name.text) ||
      !text(node.expression.expression).startsWith(replyName)
    )
      return;
    let status = node.expression.name.text === "redirect" ? 302 : 200;
    let contentType;
    walk(node.expression.expression, (item) => {
      if (ts.isCallExpression(item) && ts.isPropertyAccessExpression(item.expression)) {
        if (["status", "code"].includes(item.expression.name.text))
          status = literal(item.arguments[0]) ?? "dynamic";
        if (
          ["header", "type"].includes(item.expression.name.text) &&
          (item.expression.name.text === "type" ||
            String(literal(item.arguments[0])).toLowerCase() === "content-type")
        )
          contentType = literal(item.arguments[item.expression.name.text === "type" ? 0 : 1]);
      }
    });
    const shape = envelope(node.arguments[0]);
    const source = node.arguments[0] ? text(node.arguments[0], 900) : "(empty response)";
    const signature = `${status}:${source}`;
    if (seen.has(signature)) return;
    seen.add(signature);
    result.push({
      status,
      type: node.expression.name.text === "redirect" ? "redirect" : (contentType ?? shape.type),
      ...(shape.fields ? { fields: shape.fields } : {}),
      ...(node.expression.name.text !== "redirect" && node.arguments[0]
        ? { example: shape.example }
        : {}),
      source,
      notes: [
        "Response envelope extracted from source. Runtime values are placeholders; this is not a complete response contract.",
        ...(shape.constraints ?? []),
      ],
    });
  });
  walk(handler, (node) => {
    if (!ts.isNewExpression(node) || text(node.expression) !== "LoyaltyError") return;
    const code = literal(node.arguments?.[0]);
    const status = literal(node.arguments?.[1]);
    if (typeof code !== "string" || typeof status !== "number" || seen.has(`${status}:${code}`))
      return;
    seen.add(`${status}:${code}`);
    result.push({
      status,
      type: "object",
      example: { error: { code, message: "<localized message>" } },
      source: `LoyaltyError(${JSON.stringify(code)}, ${status})`,
      notes: [
        "Explicit route error; localized envelope is defined in apps/api/src/lib/error-handler.ts.",
      ],
    });
  });
  if (!result.length)
    result.push({
      status: "runtime",
      type: "unknown",
      notes: [
        "Response is delegated or inferred at runtime; consult the source handler. No response schema is declared.",
      ],
    });
  return result;
}
const UNKNOWN_AUTH = Symbol("unknown authentication value");
const AUTH_STRING = Symbol("string authentication value");
const authProfiles = {
  member: {
    memberId: AUTH_STRING,
    adminId: null,
    apiKeyScope: "MEMBER",
    actor: { type: "MEMBER" },
  },
  admin: {
    memberId: null,
    adminId: AUTH_STRING,
    apiKeyScope: "SERVER",
    actor: { type: "ADMIN_USER" },
  },
  server: { memberId: null, adminId: null, apiKeyScope: "SERVER", actor: { type: "API_KEY" } },
  key: { memberId: null, adminId: null, apiKeyScope: "<non-SERVER>", actor: { type: "API_KEY" } },
};
function authTruth(value) {
  return value === UNKNOWN_AUTH ? UNKNOWN_AUTH : value === AUTH_STRING ? true : Boolean(value);
}
function authValue(expression, environment) {
  expression = unwrap(expression);
  if (!expression) return UNKNOWN_AUTH;
  if (ts.isIdentifier(expression))
    return environment.values.has(expression.text)
      ? environment.values.get(expression.text)
      : UNKNOWN_AUTH;
  if (ts.isPropertyAccessExpression(expression)) {
    const receiver = authValue(expression.expression, environment);
    return receiver && typeof receiver === "object" && Object.hasOwn(receiver, expression.name.text)
      ? receiver[expression.name.text]
      : UNKNOWN_AUTH;
  }
  if (
    ts.isPrefixUnaryExpression(expression) &&
    expression.operator === ts.SyntaxKind.ExclamationToken
  ) {
    const value = authTruth(authValue(expression.operand, environment));
    return value === UNKNOWN_AUTH ? UNKNOWN_AUTH : !value;
  }
  if (ts.isTypeOfExpression(expression)) {
    const value = authValue(expression.expression, environment);
    return value === UNKNOWN_AUTH ? UNKNOWN_AUTH : value === AUTH_STRING ? "string" : typeof value;
  }
  if (ts.isBinaryExpression(expression)) {
    const left = authValue(expression.left, environment);
    const right = authValue(expression.right, environment);
    const operation = expression.operatorToken.kind;
    const l = authTruth(left),
      r = authTruth(right);
    if (operation === ts.SyntaxKind.AmpersandAmpersandToken)
      return l === false || r === false
        ? false
        : l === UNKNOWN_AUTH || r === UNKNOWN_AUTH
          ? UNKNOWN_AUTH
          : true;
    if (operation === ts.SyntaxKind.BarBarToken)
      return l === true || r === true
        ? true
        : l === UNKNOWN_AUTH || r === UNKNOWN_AUTH
          ? UNKNOWN_AUTH
          : false;
    if (operation === ts.SyntaxKind.QuestionQuestionToken)
      return left === null || left === undefined ? right : left;
    if (
      [
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ts.SyntaxKind.EqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsToken,
      ].includes(operation)
    ) {
      let equal =
        left === UNKNOWN_AUTH || right === UNKNOWN_AUTH
          ? UNKNOWN_AUTH
          : left === AUTH_STRING || right === AUTH_STRING
            ? left === null || right === null
              ? false
              : UNKNOWN_AUTH
            : left === right;
      if (text(expression.left) === text(expression.right)) equal = true;
      return equal === UNKNOWN_AUTH
        ? UNKNOWN_AUTH
        : [
              ts.SyntaxKind.ExclamationEqualsEqualsToken,
              ts.SyntaxKind.ExclamationEqualsToken,
            ].includes(operation)
          ? !equal
          : equal;
    }
  }
  const value = literal(expression);
  return value === undefined ? UNKNOWN_AUTH : value;
}
function relatedToAuth(expression, environment, requestName) {
  let related = false;
  walk(expression, (node) => {
    if (ts.isIdentifier(node) && environment.aliases.has(node.text)) related = true;
    if (
      ts.isPropertyAccessExpression(node) &&
      ["memberId", "adminId", "apiKeyScope"].includes(node.name.text) &&
      text(node.expression) === requestName
    )
      related = true;
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "type" &&
      text(node.expression) === `${requestName}.actor`
    )
      related = true;
  });
  return related;
}
function authRejection(statement) {
  let rejected = false;
  walkScope(statement, (node) => {
    if (
      ts.isNewExpression(node) &&
      text(node.expression) === "LoyaltyError" &&
      [401, 403].includes(literal(node.arguments?.[1]))
    )
      rejected = true;
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ["status", "code"].includes(node.expression.name.text) &&
      [401, 403].includes(literal(node.arguments[0]))
    )
      rejected = true;
  });
  return rejected;
}
function possibleAuthOutcomes(scope, profile) {
  const requestName = scope.requestName;
  const initial = { values: new Map([[requestName, profile]]), aliases: new Set() };
  for (const parameter of scope.node.parameters ?? []) {
    if (ts.isIdentifier(parameter.name) && parameter.name.text !== requestName)
      initial.values.set(
        parameter.name.text,
        parameter.type?.kind === ts.SyntaxKind.StringKeyword ? AUTH_STRING : UNKNOWN_AUTH,
      );
  }
  function step(statement, environment) {
    if (ts.isBlock(statement)) return sequence(statement.statements, environment);
    if (ts.isVariableStatement(statement)) {
      for (const item of statement.declarationList.declarations) {
        const value = authValue(item.initializer, environment);
        if (ts.isIdentifier(item.name)) {
          environment.values.set(item.name.text, value);
          if (relatedToAuth(item.initializer, environment, requestName))
            environment.aliases.add(item.name.text);
        } else if (ts.isObjectBindingPattern(item.name) && value && typeof value === "object") {
          for (const binding of item.name.elements)
            if (ts.isIdentifier(binding.name)) {
              const key = name(binding.propertyName ?? binding.name);
              environment.values.set(
                binding.name.text,
                Object.hasOwn(value, key) ? value[key] : UNKNOWN_AUTH,
              );
              if (["memberId", "adminId", "apiKeyScope", "actor"].includes(key))
                environment.aliases.add(binding.name.text);
            }
        }
      }
      return [{ outcome: "continue", environment }];
    }
    if (
      ts.isIfStatement(statement) &&
      relatedToAuth(statement.expression, environment, requestName)
    ) {
      const condition = authTruth(authValue(statement.expression, environment));
      const branches = condition === UNKNOWN_AUTH ? [true, false] : [condition];
      return branches.flatMap((truth) => {
        const copy = { values: new Map(environment.values), aliases: new Set(environment.aliases) };
        const branch = truth ? statement.thenStatement : statement.elseStatement;
        return branch ? step(branch, copy) : [{ outcome: "continue", environment: copy }];
      });
    }
    if (ts.isReturnStatement(statement))
      return [{ outcome: authRejection(statement) ? "rejected" : "accepted", environment }];
    if (ts.isThrowStatement(statement) && authRejection(statement))
      return [{ outcome: "rejected", environment }];
    return [{ outcome: "continue", environment }];
  }
  function sequence(statements, environment) {
    let states = [{ outcome: "continue", environment }];
    for (const statement of statements) {
      states = states.flatMap((state) =>
        state.outcome === "continue" ? step(statement, state.environment) : [state],
      );
      // Authentication predicates form only a small graph. Unknown business
      // branches are skipped, so handlers cannot cause an exponential scan.
      if (states.length > 32) return [{ outcome: "continue", environment }];
    }
    return states;
  }
  return ts.isBlock(scope.node.body)
    ? sequence(scope.node.body.statements, initial)
    : [{ outcome: "continue", environment: initial }];
}
function preHandlerFunctions(options) {
  const hooks = unwrap(property(options, "preHandler"));
  const entries = hooks && ts.isArrayLiteralExpression(hooks) ? hooks.elements : hooks ? [hooks] : [];
  return entries.map((entry) => {
    entry = unwrap(entry);
    if (ts.isArrowFunction(entry) || ts.isFunctionExpression(entry)) return entry;
    // Direct named guards carry identity requirements as well as capabilities.
    // Factory guards are handled separately by the capability extraction below.
    return ts.isIdentifier(entry) ? functionNode(entry) : undefined;
  }).filter(Boolean);
}
function allowedAuthProfiles(handler, options) {
  const scopes = [handler, ...preHandlerFunctions(options)].flatMap((rootHandler) =>
    handlerAndHelpers(rootHandler, rootHandler?.parameters?.[0]?.name?.text ?? "request")
      .filter((scope) => !scope.conditional),
  );
  return new Set(
    Object.entries(authProfiles)
      .filter(([, profile]) =>
        scopes.every((scope) =>
          possibleAuthOutcomes(scope, profile).some((state) => state.outcome !== "rejected"),
        ),
      )
      .map(([key]) => key),
  );
}
function accessInfo(route, registration, handler, options) {
  const publicRoute =
    (!registration.protected && registration.plugin !== "createFastifyMetricsPlugin") ||
    route.path.startsWith("/api/v1/auth/") ||
    route.path.startsWith("/api/v1/admin/login") ||
    route.path.startsWith("/api/v1/admin/logout") ||
    route.path.startsWith("/api/v1/admin/auth/microsoft") ||
    ["/healthz", "/readyz"].includes(route.path) ||
    (route.method === "GET" && route.path.startsWith("/api/v1/public/documentation"));
  const capabilities = new Set();
  const notes = [];
  const guarded = route.path.startsWith("/api/v1/admin/") && !publicRoute;
  const globalCapability = guarded ? capability(route.method, route.path) : null;
  if (globalCapability) capabilities.add(globalCapability);
  walk(options, (node) => {
    if (ts.isCallExpression(node) && text(node.expression) === "requireCapability") {
      const value = literal(node.arguments[0]);
      if (typeof value === "string") capabilities.add(value);
    }
  });
  walk(handler, (node) => {
    if (
      !ts.isCallExpression(node) ||
      !["assertCapability", "requireSelfOrAdmin"].includes(text(node.expression))
    )
      return;
    const value = literal(node.arguments.at(-1));
    if (typeof value === "string" && text(node.expression) === "requireSelfOrAdmin")
      notes.push(
        `A member session can access its own member ID; an admin session requires ${value}. API keys do not satisfy this helper's session requirement.`,
      );
    else if (typeof value === "string")
      notes.push(
        `${text(node.expression)} may additionally enforce ${value}; its condition is defined in the handler.`,
      );
    else
      notes.push(
        `A capability is selected dynamically (${text(node.arguments.at(-1))}); the handler enforces it for the selected resource/dataset.`,
      );
  });
  const handlerText = text(handler, 200000);
  for (const guard of preHandlerFunctions(options)) {
    const checked = new Set();
    let hasForbiddenFallback = false;
    walk(guard, (node) => {
      if (ts.isCatchClause(node) && text(node).includes('"FORBIDDEN"')) hasForbiddenFallback = true;
      if (ts.isCallExpression(node) && text(node.expression) === "assertCapability") {
        const checkedCapability = literal(node.arguments.at(-1));
        if (typeof checkedCapability === "string") checked.add(checkedCapability);
      }
    });
    if (checked.size > 1 && hasForbiddenFallback) {
      for (const checkedCapability of checked) capabilities.add(checkedCapability);
      notes.push(
        `This pre-handler accepts any one of: ${[...checked].join(" or ")}. These capabilities are alternatives, not cumulative requirements.`,
      );
    }
  }
  const allowed = allowedAuthProfiles(handler, options);
  const restricted = new Set(
    [...allowed].filter(
      (profile) => (!guarded && !capabilities.size) || profile === "admin" || profile === "server",
    ),
  );
  const memberRequired =
    (restricted.size === 1 && restricted.has("member")) ||
    (publicRoute &&
      /requestSessionIds/.test(handlerText) &&
      /lucia\.validateSession/.test(handlerText) &&
      /UNAUTHORIZED/.test(handlerText) &&
      !/invalidateSession/.test(handlerText));
  const adminSessionRequired = restricted.size === 1 && restricted.has("admin");
  const serverKeyRequired = restricted.size === 1 && restricted.has("server");
  const handoffSessionRequired =
    publicRoute &&
    /validateSession/.test(handlerText) &&
    /if\s*\(!subjectId \|\| !programId\)/.test(handlerText);
  if (publicRoute && /validateSession|readSessionCookie|UNAUTHORIZED/.test(handlerText))
    notes.push(
      "The global auth hook is skipped, but this handler performs its own session or credential validation.",
    );
  if (guarded && !adminSessionRequired)
    notes.push(
      "Admin session or SERVER-scoped API key required. SERVER keys bypass role capability checks in assertCapability; they remain restricted to their own program.",
    );
  if (memberRequired)
    notes.push(
      publicRoute
        ? "This handler requires a valid member session; API keys and admin sessions do not satisfy its member-session check."
        : "The handler requires a member session; an API key or admin session alone does not set memberId.",
    );
  if (adminSessionRequired)
    notes.push(
      "This handler additionally requires adminId; a SERVER API key alone is insufficient.",
    );
  if (serverKeyRequired)
    notes.push(
      "The handler requires SERVER scope and an API_KEY actor; member and admin sessions are insufficient.",
    );
  if (!publicRoute && restricted.size === 0)
    notes.push(
      "Authentication guards could not be reconciled statically; inspect the linked handler for accepted credentials.",
    );
  if (handoffSessionRequired)
    notes.push(
      "A valid member or admin session matching body.kind is required to issue an environment handoff ticket.",
    );
  if (publicRoute && /requestSessionIds/.test(handlerText) && /invalidateSession/.test(handlerText))
    notes.push(
      "Send the current session via Bearer or member cookie to invalidate it; the route also clears the session cookie.",
    );
  if (
    publicRoute &&
    /requestSessionIds/.test(handlerText) &&
    !/invalidateSession/.test(handlerText)
  )
    notes.push(
      "Send a member session via Bearer or loyaltyos_session cookie; this handler validates the session before returning the current member.",
    );
  return {
    mode: serverKeyRequired
      ? "admin"
      : memberRequired
        ? "member"
        : adminSessionRequired
          ? "admin"
          : handoffSessionRequired
            ? "authenticated"
            : publicRoute
              ? "public"
              : guarded || capabilities.size
                ? "admin"
                : "authenticated",
    credentials: serverKeyRequired
      ? ["X-API-Key: <server-key>"]
      : memberRequired
        ? ["Authorization: Bearer <member-session>", "Cookie: loyaltyos_session=<member-session>"]
        : adminSessionRequired
          ? ["Cookie: loyaltyos_admin_session=<admin-session>"]
          : handoffSessionRequired
            ? [
                "Authorization: Bearer <member-session>",
                "Cookie: loyaltyos_session=<member-session>",
                "Cookie: loyaltyos_admin_session=<admin-session>",
              ]
            : publicRoute
              ? []
              : [
                  ...(restricted.has("member")
                    ? [
                        "Authorization: Bearer <member-session>",
                        "Cookie: loyaltyos_session=<member-session>",
                      ]
                    : []),
                  ...(restricted.has("admin")
                    ? ["Cookie: loyaltyos_admin_session=<admin-session>"]
                    : []),
                  ...(restricted.has("key")
                    ? ["X-API-Key: <api-key>"]
                    : restricted.has("server")
                      ? ["X-API-Key: <server-key>"]
                      : []),
                ],
    capabilities: [...capabilities],
    notes,
  };
}
function summarize(method, pathname) {
  const resource = pathname
    .replace(/^\/api\/v1\//, "")
    .replaceAll(":", "")
    .split("/")
    .filter(Boolean)
    .join(" / ");
  return `${{ GET: "Read", POST: "Create or execute", PATCH: "Update", PUT: "Replace", DELETE: "Delete", HEAD: "Read headers", OPTIONS: "Preflight" }[method] ?? method} ${resource}`;
}
function groupFor(file) {
  if (file.includes("telemetry")) return "Infrastructure";
  if (file.endsWith("/health.ts")) return "Infrastructure";
  const base = path.basename(file, ".ts").replaceAll("-", " ");
  return `${file.includes("/admin/") ? "Admin · " : ""}${base.charAt(0).toUpperCase()}${base.slice(1)}`;
}
const endpoints = [];
function addRoute(node, method, pathname, options, handler, registration) {
  if (typeof pathname !== "string") {
    failures.push(`Unresolved path at ${rel(node)}:${location(node).line}`);
    return;
  }
  const fullPath =
    `${registration.prefix.replace(/\/$/, "")}/${pathname.replace(/^\//, "")}`.replace(/\/$/, "") ||
    "/";
  const route = { method: method.toUpperCase(), path: fullPath };
  const originalHandler = handler;
  const resolvedHandler = resolveHandler(handler);
  if (!resolvedHandler)
    failures.push(
      `Unresolved registered handler at ${rel(node)}:${location(node).line}: ${text(handler, 120)}`,
    );
  handler = resolvedHandler ?? handler;
  const request = requestInfo(handler);
  for (const match of fullPath.matchAll(/:([\w]+)/g))
    if (!request.params.some((item) => item.name === match[1]))
      request.params.push({
        name: match[1],
        type: "string",
        required: true,
        example: `<${match[1]}>`,
        constraints: ["Path parameter; no separate source validator extracted."],
      });
  const access = accessInfo(route, registration, handler, options);
  const notes = [];
  if (
    ts.isCallExpression(unwrap(originalHandler)) &&
    literal(unwrap(originalHandler).arguments[0]) === "REJECT"
  ) {
    walkScope(handler, (call) => {
      if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) return;
      const callee = functionNode(call.expression);
      const rejectionGuard =
        callee?.body && ts.isBlock(callee.body)
          ? callee.body.statements.find(
              (item) =>
                ts.isIfStatement(item) &&
                /REJECT/.test(text(item.expression)) &&
                /comment\?\.trim\(\)/.test(text(item.expression)) &&
                /APPROVAL_REJECTION_COMMENT_REQUIRED/.test(text(item.thenStatement)),
            )
          : undefined;
      if (!rejectionGuard) return;
      const comment = request.body?.fields?.find((item) => item.name === "comment");
      if (!comment) return;
      const constraint = `Rejection requires a nonempty comment after trimming, enforced by ${rel(rejectionGuard)}:${location(rejectionGuard).line}.`;
      comment.constraints = [...(comment.constraints ?? []), constraint];
      request.example = { ...(request.example ?? {}), comment: "<rejection reason>" };
      request.body.example = request.example;
      notes.push(constraint);
    });
  }
  const limit = property(property(options, "config"), "rateLimit");
  if (limit) notes.push(`Route-specific rate limit: ${text(limit, 300)}`);
  if (request.body?.type === "unknown")
    notes.push("Body schema could not be fully resolved; inspect the validator and linked source.");
  if (/publicProgramId/.test(text(handler)))
    notes.push(
      "Supply programId via X-Program-Id or the programId query field when required by this public authentication flow.",
    );
  if (["/metrics", "/readyz"].includes(fullPath))
    notes.push(
      "The public nginx proxy forwards /api/ and /healthz; access this infrastructure path through the backend API origin.",
    );
  const before = node.getSourceFile().text.slice(Math.max(0, node.getFullStart()), node.getStart());
  const comment = before
    .match(/\/\/\s*([^\n]+)/g)
    ?.map((item) => item.replace(/^\/\/\s*/, ""))
    .join(" ");
  if (rel(node).includes("giftcards"))
    notes.push(
      "Gift-card generation, expiration and balance refresh depend on configured queues/workers; redemption requires Redis locking. Availability depends on deployment setup.",
    );
  if (rel(node).includes("coalition"))
    notes.push(
      "External coalition operations require a configured and registered adapter for the program. Provider credentials and service availability are deployment prerequisites.",
    );
  endpoints.push({
    id: `${route.method} ${fullPath}`,
    ...route,
    group: groupFor(rel(node)),
    summary: summarize(route.method, fullPath),
    description:
      comment ??
      `Registered by ${registration.plugin}; request and response metadata below is extracted from its source.`,
    source: location(node),
    ...(["/readyz", "/metrics"].includes(fullPath) ? { backendOnly: true } : {}),
    access,
    request,
    responses: responseInfo(handler),
    notes,
  });
}
function routesIn(plugin, registration) {
  let owner = declaration(plugin);
  if (!owner) {
    failures.push(`Unresolved registered plugin ${text(plugin)}`);
    return;
  }
  let scope = owner;
  if (ts.isVariableDeclaration(owner) && owner.initializer) scope = owner.initializer;
  const appName = ts.isFunctionDeclaration(owner)
    ? (owner.parameters[0]?.name?.text ?? "app")
    : "app";
  walk(scope, (node) => {
    if (
      !ts.isCallExpression(node) ||
      !ts.isPropertyAccessExpression(node.expression) ||
      text(node.expression.expression) !== appName
    )
      return;
    const method = node.expression.name.text;
    if (methods.has(method))
      addRoute(
        node,
        method,
        literal(node.arguments[0]),
        node.arguments.length > 2 ? node.arguments[1] : undefined,
        node.arguments.at(-1),
        registration,
      );
    if (method === "route") {
      const config = node.arguments[0];
      const listed = literal(property(config, "method"));
      for (const verb of Array.isArray(listed) ? listed : [listed]) {
        if (typeof verb !== "string")
          failures.push(`Unresolved route method at ${rel(node)}:${location(node).line}`);
        else
          addRoute(
            node,
            verb,
            literal(property(config, "url")),
            config,
            property(config, "handler"),
            registration,
          );
      }
    }
  });
}
let protectedRegistration = false;
const infrastructure = [];
walk(app, (node) => {
  if (
    !ts.isCallExpression(node) ||
    !ts.isPropertyAccessExpression(node.expression) ||
    text(node.expression.expression) !== "app" ||
    node.expression.name.text !== "register"
  )
    return;
  const plugin = text(node.arguments[0]);
  if (plugin === "authPlugin") {
    protectedRegistration = true;
    return;
  }
  const registration = {
    plugin,
    prefix: literal(property(node.arguments[1], "prefix")) ?? "",
    protected: protectedRegistration,
  };
  const prefixNode = property(node.arguments[1], "prefix");
  if (prefixNode && literal(prefixNode) === undefined)
    failures.push(`Unresolved prefix for registered plugin ${plugin}`);
  const pluginDeclaration = declaration(node.arguments[0]);
  if (
    /Routes$/.test(plugin) ||
    plugin === "createFastifyMetricsPlugin" ||
    (pluginDeclaration && rel(pluginDeclaration).includes("apps/api/src/routes/"))
  )
    routesIn(node.arguments[0], registration);
  else infrastructure.push({ plugin, node, options: node.arguments[1] });
});

const swaggerRegistration = infrastructure.find((item) => item.plugin === "swaggerUi");
if (swaggerRegistration) {
  const prefix = literal(property(swaggerRegistration.options, "routePrefix"));
  if (typeof prefix !== "string") failures.push("Cannot resolve Swagger UI route prefix");
  else
    for (const [suffix, responseType, summary] of [
      ["", "redirect", "Swagger UI redirect"],
      ["/", "redirect", "Swagger UI redirect (trailing slash)"],
      ["/json", "application/json", "Generated OpenAPI document"],
      ["/yaml", "application/x-yaml", "Generated OpenAPI document as YAML"],
      ["/static/index.html", "text/html", "Swagger UI page"],
      ["/static/swagger-initializer.js", "application/javascript", "Swagger UI initializer"],
      ["/static/*", "static files", "Swagger UI assets"],
    ]) {
      const pathname = prefix + suffix;
      endpoints.push({
        id: `GET ${pathname}`,
        method: "GET",
        path: pathname,
        group: "Infrastructure",
        summary,
        description:
          "Exposed by the registered @fastify/swagger-ui plugin. OpenAPI output reflects Fastify schemas; most handlers use Zod manually, so this catalog provides additional request metadata.",
        source: location(swaggerRegistration.node),
        backendOnly: true,
        access: {
          mode: "infrastructure",
          credentials: [
            "Authorization: Bearer <member-session>",
            "Cookie: loyaltyos_admin_session=<admin-session>",
            "X-API-Key: <api-key>",
          ],
          capabilities: [],
          notes: [
            "The root authentication hook applies to Swagger routes; use a valid session or API key. The public nginx proxy does not forward /docs; use the backend API origin.",
          ],
        },
        request: { params: [], query: [], body: null, headers: [] },
        responses: [
          {
            status: responseType === "redirect" ? 302 : 200,
            type: responseType,
            notes: ["Infrastructure output is generated at runtime by @fastify/swagger-ui."],
          },
        ],
        notes: [
          "Plugin route coverage includes the static asset wildcard. Fastify may also provide implicit HEAD routes.",
        ],
      });
    }
}
const cors = infrastructure.find((item) => item.plugin === "cors");
if (cors)
  endpoints.push({
    id: "OPTIONS *",
    method: "OPTIONS",
    path: "*",
    group: "Infrastructure",
    summary: "CORS preflight",
    description:
      "Global CORS preflight handler registered by @fastify/cors; allowed origins are selected from the deployment configuration.",
    source: location(cors.node),
    access: {
      mode: "infrastructure",
      credentials: [],
      capabilities: [],
      notes: [
        "Response depends on Origin and Access-Control-Request-Method; disallowed origins are not granted CORS access.",
      ],
    },
    request: {
      params: [],
      query: [],
      body: null,
      headers: [
        { name: "Origin", type: "string", required: true, example: "https://example.com" },
        { name: "Access-Control-Request-Method", type: "string", required: true, example: "GET" },
      ],
    },
    responses: [
      {
        status: 204,
        type: "empty",
        notes: ["Default successful preflight response; invalid preflights may return an error."],
      },
    ],
    notes: [],
  });

// Root-level shorthand/route declarations are also part of the registered app.
walk(app, (node) => {
  if (
    !ts.isCallExpression(node) ||
    !ts.isPropertyAccessExpression(node.expression) ||
    text(node.expression.expression) !== "app"
  )
    return;
  const operation = node.expression.name.text;
  const registration = { plugin: "buildApp", prefix: "", protected: true };
  if (methods.has(operation))
    addRoute(
      node,
      operation,
      literal(node.arguments[0]),
      node.arguments.length > 2 ? node.arguments[1] : undefined,
      node.arguments.at(-1),
      registration,
    );
  if (operation === "route") {
    const config = node.arguments[0];
    const verbs = literal(property(config, "method"));
    for (const verb of Array.isArray(verbs) ? verbs : [verbs]) {
      if (typeof verb !== "string")
        failures.push(`Unresolved root route method at ${location(node).line}`);
      else
        addRoute(
          node,
          verb,
          literal(property(config, "url")),
          config,
          property(config, "handler"),
          registration,
        );
    }
  }
});

const ids = new Set();
for (const endpoint of endpoints) {
  if (ids.has(endpoint.id)) failures.push(`Duplicate registered endpoint: ${endpoint.id}`);
  ids.add(endpoint.id);
}
if (failures.length) throw new Error(`API reference coverage failed:\n${failures.join("\n")}`);
endpoints.sort(
  (a, b) =>
    a.group.localeCompare(b.group) ||
    a.path.localeCompare(b.path) ||
    a.method.localeCompare(b.method),
);
const notes = [
  "Generated from routes actually registered in apps/api/src/app.ts. Request validators and permissions are extracted statically; the generator does not start the API, read environment secrets, or contact services.",
  "Examples use placeholders and source literals. Unknown runtime response values remain unknown; no entity fields or undocumented response shapes are invented.",
  "Schema metadata is not a complete behavioral contract. Handler/service rules, resource ownership, workflow conditions, configuration and downstream-provider constraints can impose additional requirements; consult the linked source for conditional rules.",
  "All GET routes can have implicit HEAD counterparts supplied by Fastify. Infrastructure plugin assets are represented with their registered wildcard.",
  "Global authentication is defined in apps/api/src/plugins/auth.ts. Role capabilities and SERVER key behavior are defined in apps/api/src/lib/permissions.ts. Errors use { error: { code, message, details? } } from apps/api/src/lib/error-handler.ts; explicit route errors are listed where extractable.",
  "API keys are program-scoped; optional X-Program-Id must match the key's program. Global default rate limit is 1000 requests per minute; route-specific limits override it. Infrastructure/security/CORS settings depend on deployment configuration.",
  "MCP is a separate non-REST interface implemented in apps/mcp-server; this catalog covers the HTTP application and its infrastructure routes.",
];
const previous = fs.existsSync(outputPath)
  ? JSON.parse(fs.readFileSync(outputPath, "utf8"))
  : undefined;
const unchanged =
  previous &&
  previous.endpointCount === endpoints.length &&
  JSON.stringify(previous.endpoints) === JSON.stringify(endpoints) &&
  JSON.stringify(previous.notes) === JSON.stringify(notes);
const catalog = {
  generatedAt: unchanged ? previous.generatedAt : new Date().toISOString(),
  endpointCount: endpoints.length,
  endpoints,
  notes,
};
const serialized = `${JSON.stringify(catalog, null, 2)}\n`;
if (process.argv.includes("--check")) {
  if (!unchanged)
    throw new Error("API catalog is stale. Run node scripts/generate-api-reference.mjs.");
} else if (!unchanged) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized);
}
console.log(
  `${process.argv.includes("--check") ? "Verified" : "Generated"} ${endpoints.length} registered HTTP endpoint entries; ${endpoints.filter((item) => item.request.body).length} body schemas; ${endpoints.filter((item) => item.request.query.length).length} query schemas.`,
);
if (unresolved.size)
  console.log(
    `Unresolved schema references (${unresolved.size}, preserved as validator source):\n${[...unresolved].join("\n")}`,
  );
