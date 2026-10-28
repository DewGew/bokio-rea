import Link from "next/link";

const TABS = [
  ["/admin", "Översikt"],
  ["/admin/system", "System"],
  ["/admin/features", "Funktioner"],
  ["/admin/storage", "Lagring"],
  ["/admin/connections", "Kopplingar"],
  ["/admin/log", "Logg"],
] as const;

export function AdminTabs({ active }: { active: string }) {
  return (
    <nav className="mb-4 flex flex-wrap gap-x-5 gap-y-1 text-[14px]">
      {TABS.map(([href, label]) =>
        href === active ? (
          <span key={href} className="font-medium">{label}</span>
        ) : (
          <Link key={href} href={href} className="text-brand">{label}</Link>
        ),
      )}
    </nav>
  );
}
