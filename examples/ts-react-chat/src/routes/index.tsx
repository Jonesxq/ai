import { Link, createFileRoute } from '@tanstack/react-router'
import { NAV_SECTIONS } from '@/lib/nav-items'

function HomePage() {
  return (
    <div className="min-h-[calc(100vh-72px)] bg-gray-900 px-4 py-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="text-center">
          <h2 className="text-2xl font-semibold text-white mb-2">
            TanStack AI Examples
          </h2>
          <p className="text-gray-400 text-sm">
            Pick a demo — the same list lives in the menu.
          </p>
        </div>

        {NAV_SECTIONS.map((section) => (
          <section key={section.label}>
            <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-3">
              {section.label}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {section.items.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="flex flex-col items-center gap-2 p-4 bg-gray-800/50 border border-gray-700 rounded-lg hover:border-orange-500/40 hover:bg-gray-800 transition-colors"
                >
                  <item.icon size={24} className="text-orange-400" />
                  <span className="text-sm text-gray-300 text-center">
                    {item.label}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

export const Route = createFileRoute('/')({
  component: HomePage,
})
