import type { Metadata } from "next";
import { Libre_Franklin, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const franklin = Libre_Franklin({
  variable: "--font-franklin",
  subsets: ["latin"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Peppolsmith: a Peppol export for your billing data, checked against the bill",
  description:
    "An agent writes a Peppol BIS Billing 3.0 converter for your invoice data, runs it in a CreateOS sandbox with the network off, and releases it only when the official EU rules pass and the totals match what you billed.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${franklin.variable} ${jetbrains.variable} antialiased`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
