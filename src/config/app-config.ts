import packageJson from "../../package.json";

const currentYear = new Date().getFullYear();

export const APP_CONFIG = {
  name: "Board to Death",
  version: packageJson.version,
  copyright: `© ${currentYear}, Board to Death.`,
  meta: {
    title: "Board to Death - Event Program Dashboard",
    description:
      "Board to Death is the program dashboard for board game events: collect session proposals, run reviews, and publish your schedule.",
  },
};
