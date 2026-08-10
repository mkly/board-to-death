# CFP custom field lifecycle

CFP submission custom fields are event-scoped extensions, not questions embedded in a versioned CFP form schema. A
published CFP renders the event's current `CFP_SUBMISSION` definitions after its versioned questionnaire. Definition IDs
are the stable keys used by drafts and persisted values; labels, descriptions, ordering, and select options come from the
current event definition.

## Versioning and revisions

The CFP form version and every submission revision continue to snapshot only the schema-driven questionnaire. Custom
field values live on `CustomFieldValue` rows attached to the event and submission. They are mutable operational metadata,
so a speaker portal edit changes the current value without creating a CFP submission revision. Admin submission details
label saved values with the current event definition.

This split prevents adding an event field from publishing a new CFP form version, while the repository's composite event
relations prevent a definition or value from crossing event boundaries.

## Drafts

Draft JSON retains custom values under `customField:<definition-id>` keys. Resuming a draft restores values for definitions
that still exist in the event. A definition added after the draft was saved appears empty; a removed definition's draft
value is ignored. When the published CFP form version changes, the existing form-change warning also prompts the applicant
to review these live event fields before submitting.

## Finalization and the speaker portal

Final submission creation validates current definitions and writes custom values in the same database transaction as the
submission. Required fields therefore cannot leave behind a partially created submission. Authenticated participants may
update the same current values from their submission page; the server action rechecks portal access and submission
participation instead of trusting the route parameters.

`FILE` definitions are intentionally omitted from CFP and portal forms until their separate upload-policy and download-route
work lands. Treating an unvalidated browser file as a JSON custom value would bypass those controls.

## Views and exports

The admin detail page shows current custom values. Submission list filters, configurable columns, CSV, and XLSX exports use
the submission-view column model; adding custom-field definitions and values to that model is a separate change so exports
and filters gain the same event-scoped lookup semantics together. Existing exports therefore remain questionnaire-column
only until that work lands.
