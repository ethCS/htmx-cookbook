import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import toast from "react-hot-toast";

export default function Auth() {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ username: "", email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const { login, signup } = useAuth();
  const navigate = useNavigate();

  const handle = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const submit = async () => {
    if (!form.email || !form.password) return toast.error("Fill in all fields");
    if (mode === "signup" && !form.username) return toast.error("Username required");
    setLoading(true);
    try {
      if (mode === "login") {
        await login(form.email, form.password);
        toast.success("Welcome back");
      } else {
        await signup(form.email, form.password, form.username);
        toast.success("Account created");
      }
      navigate("/");
    } catch (err) {
      toast.error(err.message.replace("Firebase: ", "").replace(/ \(auth\/.*\)/, ""));
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => { if (e.key === "Enter") submit(); };

  return (
    <div className="min-h-[calc(100vh-65px)] bg-page flex items-center justify-center px-4">
      <div className="w-full max-w-sm">

        <div className="mb-10 text-center">
          <h1 className="text-3xl font-bold text-heading tracking-tight mb-2">
            {mode === "login" ? "Welcome back" : "Create account"}
          </h1>
          <p className="text-dim text-sm">
            {mode === "login"
              ? "Sign in to access your recipes and favorites"
              : "Start building your personal cookbook"}
          </p>
        </div>

        <div className="space-y-4">
          {mode === "signup" && (
            <div>
              <label className="block text-xs font-medium text-sub mb-1.5 uppercase tracking-wider">
                Username
              </label>
              <input
                name="username"
                type="text"
                value={form.username}
                onChange={handle}
                onKeyDown={handleKeyDown}
                placeholder="chef_john"
                className="w-full bg-card border border-edge rounded-lg px-4 py-3 text-heading placeholder-ghost focus:outline-none focus:border-accent transition-colors text-sm"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-sub mb-1.5 uppercase tracking-wider">
              Email
            </label>
            <input
              name="email"
              type="email"
              value={form.email}
              onChange={handle}
              onKeyDown={handleKeyDown}
              placeholder="you@example.com"
              className="w-full bg-card border border-edge rounded-lg px-4 py-3 text-heading placeholder-ghost focus:outline-none focus:border-accent transition-colors text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-sub mb-1.5 uppercase tracking-wider">
              Password
            </label>
            <input
              name="password"
              type="password"
              value={form.password}
              onChange={handle}
              onKeyDown={handleKeyDown}
              placeholder="••••••••"
              className="w-full bg-card border border-edge rounded-lg px-4 py-3 text-heading placeholder-ghost focus:outline-none focus:border-accent transition-colors text-sm"
            />
          </div>

          <button
            onClick={submit}
            disabled={loading}
            className="w-full bg-accent-solid hover:bg-accent-solid-hover disabled:opacity-50 disabled:cursor-not-allowed text-on-accent font-semibold rounded-lg py-3 transition-colors text-sm mt-2"
          >
            {loading ? "Please wait..." : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </div>

        <p className="text-center text-dim text-sm mt-8">
          {mode === "login" ? "Don't have an account? " : "Already have an account? "}
          <button
            onClick={() => setMode(mode === "login" ? "signup" : "login")}
            className="text-accent hover:text-accent-hover transition-colors font-medium"
          >
            {mode === "login" ? "Sign up" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}