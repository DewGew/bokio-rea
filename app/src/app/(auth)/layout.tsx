import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="mb-8 flex flex-col items-center text-center">
        <span className="mb-4 grid h-10 w-10 place-items-center rounded-lg bg-brand text-brand-ink">
          <Icon name="book" className="h-5 w-5" />
        </span>
        <p className="text-[14px] font-medium">Kapima Bokför</p>
      </div>
      <div className="card w-full max-w-[440px] p-7 sm:p-9">{children}</div>
      <p className="mt-8 max-w-sm text-center text-[13px] text-muted">Bokföring, fakturering och moms för småföretag.</p>
    </div>
  );
}
