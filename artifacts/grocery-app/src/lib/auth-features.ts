/** Build-time presentation switch. This enables the preserved preview, not SMS authentication. */
export const authFeatures = {
  mobilePreviewEnabled: () => import.meta.env?.VITE_ENABLE_MOBILE_PREVIEW === "true",
};
