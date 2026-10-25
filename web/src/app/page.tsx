import { Hero } from "@/components/Hero";
import { Nav } from "@/components/Nav";
import { Cta, Edges, Faq, Footer, ForWho, HowItWorks, Marquee, Pricing, Tools, Trust, Video } from "@/components/Sections";

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Marquee />
        <Tools />
        <HowItWorks />
        <Edges />
        <Video />
        <ForWho />
        <Pricing />
        <Trust />
        <Faq />
        <Cta />
      </main>
      <Footer />
    </>
  );
}
