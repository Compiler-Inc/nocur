/// <reference types="@welldone-software/why-did-you-render" />
/// <reference types="vite/client" />
import React from "react";

// Only enable in development
if (import.meta.env.DEV) {
  const whyDidYouRender = await import(
    "@welldone-software/why-did-you-render"
  );
  whyDidYouRender.default(React, {
    trackAllPureComponents: true,
    trackHooks: true,
    logOnDifferentValues: true,
    // Only log components that take longer than 16ms (1 frame)
    // collapseGroups: true,
    // Exclude some noisy components
    exclude: [/^BrowserRouter/, /^Link/, /^Route/],
  });
}

export {};
