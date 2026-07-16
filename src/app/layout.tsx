import type { Metadata } from "next";
import type { ReactNode } from "react";

import "../styles.css";

export const metadata: Metadata = {
  title: "Promptwell — Make the prompt hold water",
  description:
    "Turn rough ideas into specific, researched, and testable prompts through adaptive questions.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
