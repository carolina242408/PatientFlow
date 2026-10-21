export function StatCard({ title, value }: { title: string; value: number }) {
  return (
    <div className="p-4 rounded-lg border border-gray-200 bg-white">
      <p className="text-xs text-gray-500">{title}</p>
      <p className="text-2xl font-bold mt-2">{value}</p>
    </div>
  )
}
