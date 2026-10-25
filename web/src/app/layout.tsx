import type { Metadata } from "next";
import { Inter, Instrument_Serif, Outfit } from "next/font/google";
import { AccountProvider } from "@/components/studio/account";
import { TRPCProvider } from "@/trpc/client";
import "./globals.css";

const display = Outfit({ variable: "--f-display", subsets: ["latin"], weight: ["500", "600", "700", "800"] });
const body = Inter({ variable: "--f-body", subsets: ["latin"] });
const serif = Instrument_Serif({ variable: "--f-serif", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: "CutOut :) — Keep the subject. Lose the background.",
  description:
    "Click the subject once and CutOut removes the background from your image or video. Correction clicks for any miss. Pay per use with UPI.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${serif.variable}`}>
      <body>
        <TRPCProvider>
          <AccountProvider>{children}</AccountProvider>
        </TRPCProvider>
      </body>
    </html>
  );
}
