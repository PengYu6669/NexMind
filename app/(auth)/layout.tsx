export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-surface font-body text-on-surface">
      <div className="pointer-events-none fixed inset-0 tech-grid-dots" />
      <div className="pointer-events-none fixed left-[-10%] top-[-10%] h-[40%] w-[40%] rounded-full bg-primary/10 blur-[120px]" />
      <div className="pointer-events-none fixed bottom-[-10%] right-[-10%] h-[40%] w-[40%] rounded-full bg-primary-container/5 blur-[120px]" />
      {children}
    </div>
  );
}
