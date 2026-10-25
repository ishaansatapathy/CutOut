import { Suspense } from "react";
import { Nav } from "@/components/Nav";
import { Studio } from "@/components/studio/Studio";

export const metadata = { title: "Studio · CutOut :)" };

export default function AppPage() {
  return (
    <>
      <Nav />
      <Suspense>
        <Studio />
      </Suspense>
    </>
  );
}
