import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Sections";

export const metadata = { title: "Privacy policy · CutOut :)" };

export default function Privacy() {
  return (
    <>
      <Nav />
      <main className="legal wrap">
        <span className="eyebrow">Legal</span>
        <h1>Privacy policy</h1>
        <p className="legal-date">Last updated: 25 October 2026 · written for India&apos;s DPDP Act, 2023</p>

        <h2>What we collect</h2>
        <ul>
          <li><b>Images and video you upload</b>, and the results we make from them.</li>
          <li><b>Account details</b> if you sign in with Google: your email, name and profile picture.</li>
          <li><b>A device identifier</b> (a cookie and, if enabled, a fingerprint hash) to count free uses and prevent abuse. We store only a hash, never the raw fingerprint.</li>
          <li><b>Usage and payment records</b>: jobs run, credits, and order references from the payment provider. We never see your card or UPI details.</li>
        </ul>

        <h2>How long we keep it</h2>
        <p>Uploaded files and results are deleted automatically <b>24 hours</b> after they are made. Account, credit and order records are kept while your account is active so your balance is correct.</p>

        <h2>Why we use it</h2>
        <p>Only to run the service you asked for, to apply free-tier and abuse limits, to process payments, and to meet legal duties. We don&apos;t sell your data. Rewarded ads are served by an ad network under its own policy.</p>

        <h2>Your rights (DPDP)</h2>
        <p>You can ask us to show, correct or delete your personal data, and withdraw consent, by using the <a href="/report">report page</a>. Signing out and not returning stops all new processing. We&apos;ll respond within the time the law requires.</p>

        <h2>Grievance officer</h2>
        <p>A grievance officer will be named here before public launch, with a contact address, as the DPDP Act requires.</p>
      </main>
      <Footer />
    </>
  );
}
