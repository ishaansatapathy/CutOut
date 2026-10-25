import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Sections";

export const metadata = { title: "Terms of use · CutOut :)" };

export default function Terms() {
  return (
    <>
      <Nav />
      <main className="legal wrap">
        <span className="eyebrow">Legal</span>
        <h1>Terms of use</h1>
        <p className="legal-date">Last updated: 25 October 2026</p>

        <h2>1. What CutOut does</h2>
        <p>CutOut removes and edits the background of images and video, and generates images from a text prompt. By using it you agree to these terms.</p>

        <h2>2. Your content</h2>
        <p>You keep all rights to what you upload and create. You confirm you have the right to use the images and video you upload, and that they don&apos;t infringe anyone else&apos;s rights.</p>

        <h2>3. Acceptable use</h2>
        <p>Don&apos;t use CutOut to create or edit content that is illegal, that sexualises anyone, that targets or harasses a person, or that is designed to deceive — including passing off edited or generated media as an unaltered real photograph of a real event or person. Generated images are tagged as AI-made in their file data; don&apos;t strip that tag to misrepresent them.</p>

        <h2>4. Credits and payments</h2>
        <p>Paid credits are bought in prepaid packs and don&apos;t expire monthly. Credits are spent per job as shown before you confirm. If a job fails on our side, its credits are returned automatically. Credits have no cash value and are not otherwise refundable.</p>

        <h2>5. Free tier and ads</h2>
        <p>Free jobs are unlocked by watching rewarded ads, within daily limits. We may change the limits and ad counts as costs change.</p>

        <h2>6. Availability</h2>
        <p>CutOut is provided &quot;as is&quot;, without warranty. We may change, limit or stop any feature. We are not liable for lost content — keep your own copies, as uploads and results are deleted after 24 hours.</p>

        <h2>7. Contact</h2>
        <p>Questions or misuse reports: use the <a href="/report">report page</a>.</p>
      </main>
      <Footer />
    </>
  );
}
