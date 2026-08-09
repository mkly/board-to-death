import { SanitizedMarkdown } from "@/components/content/sanitized-markdown";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CfpFormDefinition } from "@/lib/cfp";

function questionTypeLabel(type: string): string {
  return type.replaceAll("_", " ");
}

export function CfpFormPreview({
  definition,
  eventName,
}: {
  readonly definition: CfpFormDefinition;
  readonly eventName: string;
}) {
  return (
    <div className="flex flex-col gap-4" data-testid="saved-cfp-preview">
      <header className="flex flex-col gap-2">
        <p className="font-medium text-muted-foreground text-sm">{eventName}</p>
        <h2 className="font-medium text-2xl leading-tight tracking-tight">
          {definition.welcomeTitle ?? definition.title}
        </h2>
        {definition.welcomeContent ? <SanitizedMarkdown content={definition.welcomeContent} /> : null}
      </header>

      {definition.instructions ? (
        <Card size="sm">
          <CardHeader>
            <CardTitle>Before you begin</CardTitle>
          </CardHeader>
          <CardContent>
            <SanitizedMarkdown content={definition.instructions} />
          </CardContent>
        </Card>
      ) : null}

      {definition.sections.map((section) => (
        <Card key={section.id} size="sm">
          <CardHeader>
            <CardTitle>{section.title}</CardTitle>
            {section.description ? <CardDescription>{section.description}</CardDescription> : null}
          </CardHeader>
          <CardContent>
            {section.questions.length === 0 ? (
              <p className="text-muted-foreground text-sm">No questions in this section.</p>
            ) : (
              <ol className="flex flex-col gap-4">
                {section.questions.map((question) => (
                  <li key={question.id} className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{question.label}</span>
                      {question.required ? <Badge variant="secondary">Required</Badge> : null}
                      <Badge variant="outline">{questionTypeLabel(question.type)}</Badge>
                    </div>
                    {question.description ? (
                      <p className="text-muted-foreground text-sm">{question.description}</p>
                    ) : null}
                    {question.constraints?.options ? (
                      <p className="text-muted-foreground text-sm">
                        Options: {question.constraints.options.map(({ label }) => label).join(", ")}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      ))}

      {definition.termsContent ? (
        <Card size="sm">
          <CardHeader>
            <CardTitle>Terms and consent</CardTitle>
            <CardDescription>
              {definition.consentRequired ? "Applicants must agree before submitting." : "Review before submitting."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SanitizedMarkdown content={definition.termsContent} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
