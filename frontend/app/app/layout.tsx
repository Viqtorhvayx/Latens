import { AppNav } from "@/components/AppNav";
import { WrongNetworkBanner } from "@/components/WrongNetworkBanner";

export default function AppShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <AppNav />
      <WrongNetworkBanner />
      {children}
    </div>
  );
}
