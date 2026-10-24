import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ber.workshed · Client CMS",
  description: "Website content management for Dapur Kita.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="id"><body>{children}</body></html>
  );
}
