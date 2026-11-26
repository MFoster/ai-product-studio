"use client";

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 40 }}>
        <h1>The studio could not be opened.</h1>
        <p>
          Check that APS_STUDIO_ROOT points to a readable studio directory
          containing config/studio.yaml and product-line/.
        </p>
        <p>No studio files were changed. See the server log for details.</p>
        <button onClick={reset}>Try again</button>
      </body>
    </html>
  );
}
