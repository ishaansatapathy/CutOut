import { Nav } from "@/components/Nav";
import { ReportForm } from "@/components/ReportForm";
import { Footer } from "@/components/Sections";

export const metadata = { title: "Report misuse · CutOut :)" };

export default function Report() {
  return (
    <>
      <Nav />
      <main className="legal wrap">
        <span className="eyebrow">Report</span>
        <h1>Report misuse or ask about your data</h1>
        <p>
          Tell us about content made with CutOut that breaks the <a href="/terms">terms</a>, or ask us to show, correct
          or delete your data under the <a href="/privacy">privacy policy</a>. We read every report.
        </p>
        <ReportForm />
      </main>
      <Footer />
    </>
  );
}
