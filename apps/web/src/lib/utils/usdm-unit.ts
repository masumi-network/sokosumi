export const usdmUnit = (network: "Mainnet" | "Preprod" | "Preview") => {
  switch (network) {
    case "Mainnet":
      return "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad0014df105553444d";
    case "Preprod":
      return "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde0014df10745553444d";
    case "Preview":
      return "usdm";
  }
};
