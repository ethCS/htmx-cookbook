import { useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Sun, Moon, Monitor } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import { mealdb } from "../../services/mealdb";
import toast from "react-hot-toast";

export default function Navbar() {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const close = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const handleLogout = async () => {
    setOpen(false);
    await logout();
    toast.success("Logged out");
    navigate("/");
  };

  const initial = user?.email?.[0]?.toUpperCase() || "?";

  const themeOptions = [
    { value: "light", Icon: Sun },
    { value: "dark", Icon: Moon },
    { value: "system", Icon: Monitor },
  ];

  return (
    <nav className="border-b border-edge px-6 py-4 flex items-center justify-between">
      <Link to="/" onClick={() => mealdb.invalidateRandom()} className="text-xl font-bold tracking-tight text-accent">
        CSCI322 Cookbook
      </Link>
      <div className="flex items-center gap-6 text-sm text-dim">
        <Link to="/search" className="hover:text-heading transition-colors">Explore</Link>
        {user && <Link to="/favorites" className="hover:text-heading transition-colors">Favorites</Link>}
        {user && <Link to="/my-recipes" className="hover:text-heading transition-colors">My Recipes</Link>}

        {user ? (
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setOpen(!open)}
              className="w-8 h-8 rounded-full bg-accent-solid text-on-accent font-semibold text-xs flex items-center justify-center hover:bg-accent-solid-hover transition-colors"
            >
              {initial}
            </button>

            {open && (
              <div className="absolute right-0 mt-2 w-48 bg-card border border-edge rounded-xl shadow-lg py-2 z-50">
                <p className="px-4 py-2 text-xs text-dim truncate border-b border-edge">
                  {user.email}
                </p>

                <div className="px-4 py-3 border-b border-edge">
                  <p className="text-xs text-dim mb-2">Theme</p>
                  <div className="flex gap-1">
                    {themeOptions.map(({ value, Icon }) => (
                      <button
                        key={value}
                        onClick={() => setTheme(value)}
                        className={`flex-1 flex items-center justify-center py-1.5 rounded-lg text-xs transition-colors ${
                          theme === value
                            ? "bg-accent-solid text-on-accent"
                            : "text-sub hover:bg-card-hover"
                        }`}
                      >
                        <Icon size={12} />
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={handleLogout}
                  className="w-full text-left px-4 py-2 text-sm text-sub hover:text-heading hover:bg-card-hover transition-colors"
                >
                  Log out
                </button>
              </div>
            )}
          </div>
        ) : (
          <Link to="/auth" className="hover:text-heading transition-colors">Sign in</Link>
        )}
      </div>
    </nav>
  );
}