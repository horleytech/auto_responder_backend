import { House, Moon, Sun } from 'lucide-react';

const navItems = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'requests', label: 'Market' },
  { id: 'online-customers', label: 'Online Customers' },
  { id: 'dictionary', label: 'Dictionary' },
  { id: 'bot-logic', label: 'Bot Logic' },
  { id: 'settings', label: 'Settings' },
];

export default function DashboardLayout({ activePage, onPageChange, darkMode, onToggleTheme, children }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto flex max-w-7xl gap-6 p-4 md:p-6">
        <aside className="sticky top-4 h-[calc(100vh-2rem)] w-64 rounded-2xl border border-slate-200 bg-white p-4 shadow-premium dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-8">
            <h1 className="text-lg font-semibold">Auto Responder</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">System Console</p>
          </div>

          <a
            className="mb-3 flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white"
            href="https://scrapebot.horleytech.com/hub"
          >
            <House size={16} /> Home Hub
          </a>

          <button
            type="button"
            onClick={() => onPageChange('online-customers')}
            className="mb-3 w-full rounded-xl bg-indigo-600 px-3 py-2 text-sm font-medium text-white"
          >
            Open Online Customers
          </button>

          <nav className="space-y-2">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => onPageChange(item.id)}
                className={`w-full rounded-xl px-3 py-2 text-left text-sm transition ${
                  activePage === item.id
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <button
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-700"
            onClick={onToggleTheme}
          >
            {darkMode ? <Sun size={16} /> : <Moon size={16} />} {darkMode ? 'Light Mode' : 'Dark Mode'}
          </button>
        </aside>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
