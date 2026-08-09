import { z } from "zod";

import type { ContactGroupIntakeForm, ContactGroupKind, Prisma, PrismaClient } from "../../generated/prisma/client.ts";
import { RepositoryError } from "../events/repositories.ts";
import { createContact, createContactGroup, slugifyGroupName } from "./repositories.ts";

const submissionSchema = z.object({
  organizationName: z.string().trim().min(1, "Enter an organization name."),
  contactGivenName: z.string().trim().min(1, "Enter a first name."),
  contactFamilyName: z.string().trim().min(1, "Enter a last name."),
  contactEmail: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email({ message: "Enter a valid email address." })),
  contactPhone: z.string().trim().optional(),
  contactJobTitle: z.string().trim().optional(),
});

const publicationSchema = z.object({
  title: z.string().trim().min(1, "Enter a form title."),
  description: z.string().trim().optional(),
});

export type ContactGroupIntakeFormWithEvent = Prisma.ContactGroupIntakeFormGetPayload<{
  include: { event: { select: { id: true; name: true; slug: true } } };
}>;

export type ContactGroupIntakeSubmissionWithDetails = Prisma.ContactGroupIntakeSubmissionGetPayload<{
  include: { form: true; acceptedGroup: true; acceptedContact: true; reviewedBy: true };
}>;

export interface ContactGroupIntakeSubmissionInput {
  readonly organizationName: string;
  readonly contactGivenName: string;
  readonly contactFamilyName: string;
  readonly contactEmail: string;
  readonly contactPhone?: string;
  readonly contactJobTitle?: string;
}

function invalid(message: string): never {
  throw new RepositoryError("invalid-input", message);
}

function parseSubmission(input: ContactGroupIntakeSubmissionInput) {
  const parsed = submissionSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? "Review the submitted contact details.");
  return parsed.data;
}

function parsePublication(input: { readonly title: string; readonly description?: string }) {
  const parsed = publicationSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? "Review the form settings.");
  return parsed.data;
}

async function requireEnabledKind(
  client: Prisma.TransactionClient,
  eventId: string,
  kind: ContactGroupKind,
): Promise<void> {
  const event = await client.event.findUnique({
    where: { id: eventId },
    select: { exhibitorsEnabled: true, sponsorsEnabled: true },
  });
  if (!event) throw new RepositoryError("not-found", "The event was not found.");
  const enabled = kind === "SPONSOR" ? event.sponsorsEnabled : event.exhibitorsEnabled;
  if (!enabled) invalid(`${kind === "SPONSOR" ? "Sponsors" : "Exhibitors"} are not enabled for this event.`);
}

export async function publishContactGroupIntakeForm(
  client: Prisma.TransactionClient,
  eventId: string,
  kind: ContactGroupKind,
  input: { readonly title: string; readonly description?: string },
): Promise<ContactGroupIntakeForm> {
  await requireEnabledKind(client, eventId, kind);
  const definition = parsePublication(input);
  const now = new Date();
  return client.contactGroupIntakeForm.upsert({
    where: { eventId_kind: { eventId, kind } },
    create: {
      eventId,
      kind,
      title: definition.title,
      description: definition.description || null,
      status: "PUBLISHED",
      publishedAt: now,
    },
    update: {
      title: definition.title,
      description: definition.description || null,
      status: "PUBLISHED",
      publishedAt: now,
      closedAt: null,
    },
  });
}

export async function closeContactGroupIntakeForm(
  client: Prisma.TransactionClient,
  eventId: string,
  kind: ContactGroupKind,
): Promise<ContactGroupIntakeForm> {
  try {
    return await client.contactGroupIntakeForm.update({
      where: { eventId_kind: { eventId, kind } },
      data: { status: "CLOSED", closedAt: new Date() },
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2025") {
      throw new RepositoryError("not-found", "Publish this intake form before closing it.");
    }
    throw error;
  }
}

export async function listContactGroupIntakeForms(
  client: Prisma.TransactionClient,
  eventId: string,
): Promise<readonly ContactGroupIntakeForm[]> {
  return client.contactGroupIntakeForm.findMany({ where: { eventId }, orderBy: { kind: "asc" } });
}

export async function getContactGroupIntakeFormByPublicId(
  client: Prisma.TransactionClient,
  publicId: string,
): Promise<ContactGroupIntakeFormWithEvent | null> {
  if (!z.uuid().safeParse(publicId).success) return null;
  return client.contactGroupIntakeForm.findUnique({
    where: { publicId },
    include: { event: { select: { id: true, name: true, slug: true } } },
  });
}

export async function submitContactGroupIntakeForm(
  client: Prisma.TransactionClient,
  publicId: string,
  input: ContactGroupIntakeSubmissionInput,
) {
  const form = await getContactGroupIntakeFormByPublicId(client, publicId);
  if (form?.status !== "PUBLISHED") {
    throw new RepositoryError("not-found", "This partner intake form is not accepting responses.");
  }
  const submitted = parseSubmission(input);
  return client.contactGroupIntakeSubmission.create({
    data: {
      eventId: form.eventId,
      formId: form.id,
      organizationName: submitted.organizationName,
      organizationSlug: slugifyGroupName(submitted.organizationName),
      contactGivenName: submitted.contactGivenName,
      contactFamilyName: submitted.contactFamilyName,
      contactEmail: submitted.contactEmail,
      contactPhone: submitted.contactPhone || null,
      contactJobTitle: submitted.contactJobTitle || null,
    },
  });
}

export async function listContactGroupIntakeSubmissions(
  client: Prisma.TransactionClient,
  eventId: string,
): Promise<readonly ContactGroupIntakeSubmissionWithDetails[]> {
  return client.contactGroupIntakeSubmission.findMany({
    where: { eventId },
    include: { form: true, acceptedGroup: true, acceptedContact: true, reviewedBy: true },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
}

export async function acceptContactGroupIntakeSubmission(
  client: PrismaClient,
  eventId: string,
  submissionId: string,
  reviewerId: string,
): Promise<{ readonly groupId: string; readonly contactId: string }> {
  return client.$transaction(async (transaction) => {
    const submission = await transaction.contactGroupIntakeSubmission.findUnique({
      where: { eventId_id: { eventId, id: submissionId } },
      include: { form: true },
    });
    if (!submission) throw new RepositoryError("not-found", "The event-owned intake submission was not found.");
    const claimed = await transaction.contactGroupIntakeSubmission.updateMany({
      where: { eventId, id: submissionId, status: "PENDING" },
      data: { status: "ACCEPTED", reviewedAt: new Date(), reviewedById: reviewerId },
    });
    if (claimed.count !== 1) invalid("This intake submission has already been reviewed.");

    let contact = await transaction.contact.findUnique({
      where: { eventId_email: { eventId, email: submission.contactEmail } },
    });
    if (contact) {
      contact = await transaction.contact.update({
        where: { eventId_id: { eventId, id: contact.id } },
        data: {
          givenName: submission.contactGivenName,
          familyName: submission.contactFamilyName,
          organization: submission.organizationName,
          jobTitle: submission.contactJobTitle ?? contact.jobTitle,
          phone: submission.contactPhone ?? contact.phone,
          archivedAt: null,
        },
      });
    } else {
      contact = await createContact(transaction, {
        eventId,
        email: submission.contactEmail,
        givenName: submission.contactGivenName,
        familyName: submission.contactFamilyName,
        organization: submission.organizationName,
        jobTitle: submission.contactJobTitle,
        phone: submission.contactPhone,
      });
    }

    let group = await transaction.contactGroup.findUnique({
      where: { eventId_slug: { eventId, slug: submission.organizationSlug } },
    });
    if (group && group.kind !== submission.form.kind) {
      invalid("An organization with this name already exists under the other partner kind.");
    }
    if (group) {
      group = await transaction.contactGroup.update({
        where: { eventId_id: { eventId, id: group.id } },
        data: { archivedAt: null, primaryContactId: contact.id },
      });
      await transaction.contactGroupMember.upsert({
        where: { groupId_contactId: { groupId: group.id, contactId: contact.id } },
        create: { eventId, groupId: group.id, contactId: contact.id },
        update: {},
      });
    } else {
      group = await createContactGroup(transaction, {
        eventId,
        kind: submission.form.kind,
        name: submission.organizationName,
        slug: submission.organizationSlug,
        primaryContactId: contact.id,
      });
    }

    await transaction.contactGroupIntakeSubmission.update({
      where: { eventId_id: { eventId, id: submissionId } },
      data: { acceptedGroupId: group.id, acceptedContactId: contact.id },
    });
    return { groupId: group.id, contactId: contact.id };
  });
}

export async function rejectContactGroupIntakeSubmission(
  client: Prisma.TransactionClient,
  eventId: string,
  submissionId: string,
  reviewerId: string,
): Promise<void> {
  const result = await client.contactGroupIntakeSubmission.updateMany({
    where: { eventId, id: submissionId, status: "PENDING" },
    data: { status: "REJECTED", reviewedAt: new Date(), reviewedById: reviewerId },
  });
  if (result.count !== 1) throw new RepositoryError("not-found", "The pending event-owned submission was not found.");
}
