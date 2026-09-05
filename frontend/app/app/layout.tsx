import { AppNav } from "@/components/AppNav";

export default function AppShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <AppNav />
      {children}
    </div>
  );
}
