export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <main className="flowday-app">{children}</main>;
}
