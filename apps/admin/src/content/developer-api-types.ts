/** Metadata extracted from registered API source; examples are placeholders, never live data. */
export interface ApiSchema {
  type: string;
  required: boolean;
  nullable?: boolean;
  fields?: ApiField[];
  items?: ApiSchema;
  enum?: unknown[];
  default?: unknown;
  constraints?: string[];
  validator?: string;
  example?: unknown;
  alternatives?: ApiSchema[];
}

export interface ApiField extends ApiSchema {
  name: string;
}

export interface ApiResponse {
  status: number | string;
  type: string;
  fields?: ApiField[];
  example?: unknown;
  source?: string;
  notes?: string[];
}

export interface ApiEndpoint {
  id: string;
  method: string;
  path: string;
  group: string;
  summary: string;
  description: string;
  source: { file: string; line: number };
  /** Not forwarded by the repository's public nginx API proxy. */
  backendOnly?: boolean;
  access: {
    mode: "public" | "admin" | "member" | "authenticated" | "infrastructure";
    credentials: string[];
    capabilities: string[];
    notes: string[];
  };
  request: {
    params: ApiField[];
    query: ApiField[];
    body: ApiSchema | null;
    headers: ApiField[];
    example?: unknown;
  };
  responses: ApiResponse[];
  notes: string[];
}

export interface ApiReferenceCatalog {
  generatedAt: string;
  endpointCount: number;
  endpoints: ApiEndpoint[];
  notes?: string[];
}
