import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export default function PasswordField({ label, value, onChange, placeholder }) {
  const [visible, setVisible] = useState(false);

  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium">{label}</span>
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 pr-12 text-sm outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900"
        />
        <button
          type="button"
          onClick={() => setVisible((prev) => !prev)}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
    </label>
  );
}
