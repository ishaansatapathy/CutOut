import { Nav } from "@/components/Nav";
import { AccountPage } from "@/components/studio/AccountPage";

export const metadata = { title: "Account · CutOut :)" };

export default function Page() {
  return (
    <>
      <Nav />
      <AccountPage />
    </>
  );
}
