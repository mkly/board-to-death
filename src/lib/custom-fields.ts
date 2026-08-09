export const customFieldFormPrefix = "customField:";

export const CustomFieldEntityType = {
  CONTACT: "CONTACT",
  PROGRAM_SESSION: "PROGRAM_SESSION",
  CONTACT_GROUP: "CONTACT_GROUP",
  CFP_SUBMISSION: "CFP_SUBMISSION",
} as const;

export type CustomFieldEntityType = (typeof CustomFieldEntityType)[keyof typeof CustomFieldEntityType];

export const CustomFieldType = {
  SINGLE_LINE_TEXT: "SINGLE_LINE_TEXT",
  LONG_TEXT: "LONG_TEXT",
  NUMBER: "NUMBER",
  DATE: "DATE",
  SINGLE_SELECT: "SINGLE_SELECT",
  MULTI_SELECT: "MULTI_SELECT",
  CHECKBOX: "CHECKBOX",
  URL: "URL",
  FILE: "FILE",
} as const;

export type CustomFieldType = (typeof CustomFieldType)[keyof typeof CustomFieldType];
