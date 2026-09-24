import { ui } from "@/lib/ui-text";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clock3, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { fetchApi } from "@/lib/api-client";

interface Decision {
  id: string;
  decision: "APPROVE" | "REJECT";
  comment: string | null;
  createdAt: string;
  approver: { id: string; name: string; email: string; role: string };
}
interface RequestStep {
  id: string;
  stepOrder: number;
  name: string;
  approvalMode: "ANY" | "ALL" | "COUNT";
  requiredApprovalCount: number;
  status: "WAITING" | "PENDING" | "APPROVED" | "REJECTED" | "SKIPPED";
  assigneesSnapshot: { adminId: string; name: string; email: string; role: string }[];
  decisions: Decision[];
}
interface ApprovalRequest {
  payload?: Record<string, unknown>;
  id: string;
  actionKey: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  subjectType: string;
  subjectId: string;
  requestedByType: string;
  requestedById: string;
  requestedAt: string;
  currentStepOrder: number | null;
  workflow: { actionKey: string; name: string };
  steps: RequestStep[];
}
interface AdminMe { id: string }

export function ApprovalsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"inbox" | "history">("inbox");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const currentAdmin = useQuery({
    queryKey: ["admin", "me"],
    queryFn: () => fetchApi<AdminMe>("/admin/me"),
  });
  const inbox = useQuery({
    queryKey: ["admin", "approvals", "inbox"],
    queryFn: () => fetchApi<ApprovalRequest[]>("/admin/approvals/inbox"),
  });
  useEffect(() => {
    const requestId = searchParams.get("request");
    if (!requestId || !inbox.data?.some((request) => request.id === requestId)) return;
    setTab("inbox");
    setSelectedId(requestId);
  }, [inbox.data, searchParams]);
  const history = useQuery({
    queryKey: ["admin", "approvals", "history"],
    queryFn: () => fetchApi<ApprovalRequest[]>("/admin/approvals/history"),
    enabled: tab === "history",
  });
  const detail = useQuery({
    queryKey: ["admin", "approval", selectedId],
    queryFn: () => fetchApi<ApprovalRequest>(`/admin/approvals/${selectedId ?? ""}`),
    enabled: Boolean(selectedId),
  });
  const decide = useMutation({
    mutationFn: (decision: "approve" | "reject") =>
      fetchApi<ApprovalRequest>(`/admin/approvals/${selectedId ?? ""}/${decision}`, {
        method: "POST",
        body: JSON.stringify({ comment: comment.trim() || undefined }),
      }),
    onSuccess: async (request) => {
      setComment("");
      setNotice(`Request ${request.status.toLowerCase()}.`);
      await queryClient.invalidateQueries({ queryKey: ["admin", "approvals"] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "approval", selectedId] });
    },
    onError: (error: Error) => { setNotice(error.message); },
  });

  const rows = tab === "inbox" ? inbox.data ?? [] : history.data ?? [];
  const selected = detail.data;
  const activeStep = selected?.steps.find((step) => step.status === "PENDING");
  const canDecide = Boolean(
    activeStep &&
      currentAdmin.data?.id &&
      activeStep.assigneesSnapshot.some((assignee) => assignee.adminId === currentAdmin.data.id),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold"><Clock3 />{ui("Approval inbox")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{ui("Only active assignees for the current layer can decide. Every decision is immutable and retained with its workflow snapshot.")}</p>
      </div>
      {notice && <div role="status" className="rounded-md border bg-muted p-3 text-sm">{notice}</div>}
      <div className="flex gap-2 border-b"><Button type="button" variant={tab === "inbox" ? "default" : "ghost"} onClick={() => { setTab("inbox"); }}>{ui("My inbox")}</Button><Button type="button" variant={tab === "history" ? "default" : "ghost"} onClick={() => { setTab("history"); }}>{ui("History")}</Button></div>
      <div className="grid gap-6 xl:grid-cols-[minmax(18rem,1fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader><CardTitle>{tab === "inbox" ? ui("Pending for me") : ui("All requests")}</CardTitle><CardDescription>{rows.length} {ui("request(s)")}</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            {((tab === "inbox" ? inbox.isLoading : history.isLoading) && <p className="text-sm text-muted-foreground">{ui("Loading approvals…")}</p>)}
            {rows.map((request) => <button type="button" key={request.id} className={`w-full rounded-md border p-3 text-left ${selectedId === request.id ? "border-primary bg-accent" : ""}`} onClick={() => { setSelectedId(request.id); }}><p className="font-medium">{request.workflow.name}</p><p className="text-xs text-muted-foreground">{request.actionKey} · {request.subjectType}</p><p className="mt-1 text-xs">{request.status} · {new Date(request.requestedAt).toLocaleString()}</p></button>)}
            {!rows.length && <p className="text-sm text-muted-foreground">{ui("No approval requests.")}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{selected ? `${selected.workflow.name} · ${selected.status}` : ui("Select an approval request")}</CardTitle><CardDescription>{selected ? `${ui("Action")} ${selected.actionKey} · ${selected.subjectType} ${selected.subjectId}` : ui("Review request data and layer history.")}</CardDescription></CardHeader>
          <CardContent className="space-y-5">
            {selected && <>
              {selected.subjectType === "CAMPAIGN_ISSUANCE" && <div className="rounded-md border p-3 space-y-2"><h3>{ui("Campaign issuance proposal")}</h3>{Object.entries(selected.payload ?? {}).map(([key, value]) => <p key={key} className="text-sm"><strong>{ui(key)}</strong>: {value === null ? "—" : String(value)}</p>)}</div>}
              <div className="rounded-md border bg-muted/40 p-3 text-sm"><p>{ui("Requested by:")} {selected.requestedByType} / {selected.requestedById}</p><p>{ui("Requested at:")} {new Date(selected.requestedAt).toLocaleString()}</p></div>
              <div className="space-y-3"><h3 className="font-semibold">{ui("Progress and decisions")}</h3>{selected.steps.map((step) => <div key={step.id} className="rounded-md border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{ui("Layer")} {step.stepOrder}: {step.name}</p><span className="text-xs">{step.status} · {step.approvalMode === "ALL" ? ui("all assignees") : `${String(step.requiredApprovalCount)} ${ui("approval(s)")}`}</span></div><p className="mt-1 text-xs text-muted-foreground">{ui("Assigned snapshot:")} {step.assigneesSnapshot.map((assignee) => assignee.name).join(", ")}</p>{step.decisions.map((decision) => <div className="mt-2 border-l-2 pl-3 text-sm" key={decision.id}><p>{decision.decision} {ui("by")} {decision.approver.name} · {new Date(decision.createdAt).toLocaleString()}</p>{decision.comment && <p className="text-muted-foreground">{decision.comment}</p>}</div>)}</div>)}</div>
              {selected.status === "PENDING" && activeStep && canDecide && <div className="space-y-3 rounded-md border p-4"><Label htmlFor="approval-comment" data-help={ui("Optional context for approval; required when rejecting so the audit trail explains the termination.")}>{ui("Decision comment")}</Label><textarea id="approval-comment" className="min-h-20 w-full rounded-md border bg-background p-2 text-sm" value={comment} onChange={(event) => { setComment(event.target.value); }} /><div className="flex gap-2"><Button disabled={decide.isPending} onClick={() => { decide.mutate("approve"); }}><Check className="mr-2 h-4 w-4" />{ui("Approve")}</Button><Button variant="destructive" disabled={decide.isPending || !comment.trim()} onClick={() => { decide.mutate("reject"); }}><X className="mr-2 h-4 w-4" />{ui("Reject")}</Button></div></div>}
            </>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
