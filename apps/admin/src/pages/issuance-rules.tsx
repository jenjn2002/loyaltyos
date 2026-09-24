import { ui } from "@/lib/ui-text";
import { ArrowRight, ShieldCheck, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function IssuanceRulesPage(): JSX.Element {
  const navigate = useNavigate();
  return (
    <div className="space-y-6 pb-10">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold"><Zap />{ui("Point issuance")}</h1>
        <p className="mt-1 max-w-4xl text-sm text-muted-foreground">
          {ui("Event definitions configure when an event occurs; campaigns configure the audience, points and approval policy.")}
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{ui("Standing occasion campaigns")}</CardTitle>
          <CardDescription>{ui("Use scheduled occasions such as onboarding, birthdays, work anniversaries and fixed company dates. Choose Standing campaign when the points may run automatically after activation.")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button onClick={() => navigate("/campaigns/new")}>{ui("Open campaign builder")}<ArrowRight className="ml-2 h-4 w-4" /></Button>
          <Button variant="outline" onClick={() => navigate("/event-definitions")}>{ui("Configure event definitions")}</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck />{ui("Campaign approval")}</CardTitle>
          <CardDescription>{ui("Choose Approval required in the campaign for an exceptional grant, add a justification and submit it for approval. No points are issued while it is a draft or pending approval.")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{ui("This approval applies to the campaign configuration and its target audience, schedule and budget. It is separate from a manual grant proposal for one member.")}</p>
          <Button onClick={() => navigate("/campaigns/new")}><ShieldCheck className="mr-2 h-4 w-4" />{ui("Create campaign proposal")}</Button>
        </CardContent>
      </Card>
    </div>
  );
}
