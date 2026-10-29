import { requireAdmin } from "@/lib/admin";
import { externalServices } from "@/lib/admin-services";
import { AdminTabs } from "@/components/AdminTabs";
import { Card, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AdminServices() {
  await requireAdmin();
  const services = externalServices();
  return (
    <>
      <PageHeader title="Administration" subtitle="Externa tjänster som appen är kopplad till, med genvägar till deras egna sidor. Länkarna öppnas i en ny flik." />
      <AdminTabs active="/admin/services" />
      <Card title="Tjänster">
        <ul className="divide-y divide-line">
          {services.map((s) => (
            <li key={s.name} className="flex flex-wrap items-center gap-4 px-5 py-4">
              <div className="min-w-0 flex-1 text-[14px]">
                <p className="text-[15px] font-medium">{s.name}</p>
                <p className="text-muted">{s.used}</p>
                {s.status && <p className={`text-[13px] ${s.status.ok ? "text-success" : "text-danger"}`}>● {s.status.text}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                {s.links.map((l) => (
                  <a key={l.href + l.label} href={l.href} target="_blank" rel="noopener noreferrer" className="btn-secondary">
                    {l.label} ↗
                  </a>
                ))}
              </div>
            </li>
          ))}
        </ul>
        <p className="px-5 pb-4 text-[13px] text-muted">Länkarna går till tjänsternas startsidor. Inloggning och val av projekt sker hos respektive tjänst. Inga nycklar eller värden visas här.</p>
      </Card>
    </>
  );
}
