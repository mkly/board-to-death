import packageJson from "../../package.json";

const currentYear = new Date().getFullYear();

export const APP_CONFIG = {
  name: "GatherPulse",
  version: packageJson.version,
  copyright: `© ${currentYear}, GatherPulse.`,
  meta: {
    title: "GatherPulse - Event Program Dashboard",
    description:
      "GatherPulse is the program dashboard for board game events: collect session proposals, run reviews, and publish your schedule.",
  },
};
