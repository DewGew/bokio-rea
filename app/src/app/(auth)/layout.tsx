import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="mb-8 flex flex-col items-center text-center">
        <span className="mb-4 grid h-16 w-16 place-items-center rounded-[18px] bg-gradient-to-br from-[#2b90ff] to-[#0058d1] text-white shadow-lg shadow-[#0071e3]/25">
          <Icon name="book" className="h-8 w-8" />
        </span>
        <p className="text-[15px] text-muted">Huvudbok</p>
      </div>
      <div className="card w-full max-w-[440px] p-7 sm:p-9">{children}</div>
      <p className="mt-8 max-w-sm text-center text-[13px] text-muted">Bokföring, fakturering och moms för småföretag.</p>
    </div>
  );
}
