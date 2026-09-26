/** Only the page routes in the migration inventory may leave this app. */
export const isLegacyPage = (pathname: string) =>
  /^\/(map|donate|liff|coop|holder)\/?$/.test(pathname) ||
  /^\/verify\/[^/]+\/?$/.test(pathname);
