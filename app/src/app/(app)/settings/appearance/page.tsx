import { requireCompany } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { ThemePicker } from "@/components/ThemePicker";

export default async function Appearance() {
  const { user } = await requireCompany();
  return (
    <>
      <PageHeader title="Utseende" subtitle="Välj hur Huvudbok ska se ut. Inställningen sparas på ditt konto och gäller på alla enheter." />
      <Card title="Tema" className="max-w-3xl">
        <div className="px-5 pb-5 pt-2">
          <ThemePicker current={user.theme} />
        </div>
      </Card>
    </>
  );
}
