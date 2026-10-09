export interface ExchangeAdminIdentity {
  id: string;
  name: string;
  email: string | null;
}

export interface ExchangeApprovalRequest {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  currentStepOrder: number | null;
  workflowName: string;
  requestedAt: string;
  resolvedAt: string | null;
  resolutionComment: string | null;
  steps: {
    id: string;
    stepOrder: number;
    name: string;
    approvalMode: "ANY" | "ALL" | "COUNT";
    requiredApprovalCount: number;
    status: "WAITING" | "PENDING" | "APPROVED" | "REJECTED" | "SKIPPED";
    openedAt?: string | null;
    completedAt?: string | null;
    assigneesSnapshot: {
      adminId: string;
      name: string;
      email: string | null;
      role: string;
    }[];
    decisions: {
      id: string;
      decision: "APPROVE" | "REJECT";
      comment: string | null;
      createdAt: string;
      approver: ExchangeAdminIdentity & { role: string };
    }[];
  }[];
}

export function isAutomaticExchangeCompletion(
  reference: string | null,
  approvalRequest: Pick<ExchangeApprovalRequest, "id"> | null,
): boolean {
  return Boolean(approvalRequest && reference === `approval:${approvalRequest.id}`);
}
