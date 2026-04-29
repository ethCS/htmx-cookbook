import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { db } from "../services/firebase";
import {
  collection, addDoc, deleteDoc, doc,
  onSnapshot, serverTimestamp
} from "firebase/firestore";
import toast from "react-hot-toast";

const EMPTY_FORM = {
  title: "",
  description: "",
  ingredients: "",
  instructions: "",
  prepTime: "",
  servings: "",
  tags: "",
};

export default function MyRecipes() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [recipes, setRecipes] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (!user) return;
    const ref = collection(db, "users", user.uid, "customRecipes");
    const unsub = onSnapshot(ref, (snap) => {
      setRecipes(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [user]);

  const handle = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const submit = async () => {
    if (!form.title.trim()) return toast.error("Title is required");
    if (!form.ingredients.trim()) return toast.error("Ingredients are required");
    if (!form.instructions.trim()) return toast.error("Instructions are required");
    setSaving(true);
    try {
      const ref = collection(db, "users", user.uid, "customRecipes");
      await addDoc(ref, {
        title: form.title.trim(),
        description: form.description.trim(),
        ingredients: form.ingredients.split("\n").map(s => s.trim()).filter(Boolean),
        instructions: form.instructions.trim(),
        prepTime: parseInt(form.prepTime) || null,
        servings: parseInt(form.servings) || null,
        tags: form.tags.split(",").map(s => s.trim()).filter(Boolean),
        createdAt: serverTimestamp(),
      });
      toast.success("Recipe saved");
      setForm(EMPTY_FORM);
      setShowForm(false);
    } catch (err) {
      toast.error("Failed to save recipe");
    } finally {
      setSaving(false);
    }
  };

  const deleteRecipe = async (id) => {
    await deleteDoc(doc(db, "users", user.uid, "customRecipes", id));
    if (selected?.id === id) setSelected(null);
    toast.success("Recipe deleted");
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center">
        <div className="text-center">
          <p className="text-sub text-lg mb-4">Sign in to manage your recipes</p>
          <button
            onClick={() => navigate("/auth")}
            className="bg-accent-solid hover:bg-accent-solid-hover text-on-accent font-semibold px-6 py-2.5 rounded-xl text-sm transition-colors"
          >
            Sign in
          </button>
        </div>
      </div>
    );
  }

  if (selected) {
    return (
      <div className="min-h-screen bg-page px-6 pt-12 pb-24 max-w-3xl mx-auto">
        <button
          onClick={() => setSelected(null)}
          className="text-dim hover:text-body text-sm mb-8 transition-colors"
        >
          Back to My Recipes
        </button>

        <h1 className="text-3xl font-bold text-heading tracking-tight mb-3">{selected.title}</h1>

        <div className="flex flex-wrap gap-2 mb-6">
          {selected.prepTime && (
            <span className="px-3 py-1 bg-chip border border-edge-hover text-sub rounded-full text-xs">
              {selected.prepTime} min
            </span>
          )}
          {selected.servings && (
            <span className="px-3 py-1 bg-chip border border-edge-hover text-sub rounded-full text-xs">
              {selected.servings} servings
            </span>
          )}
          {selected.tags?.map(tag => (
            <span key={tag} className="px-3 py-1 bg-accent/10 border border-accent/20 text-accent rounded-full text-xs">
              {tag}
            </span>
          ))}
        </div>

        {selected.description && (
          <p className="text-sub text-sm leading-relaxed mb-8">{selected.description}</p>
        )}

        <div className="grid sm:grid-cols-3 gap-8">
          <div className="sm:col-span-1">
            <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-dim mb-4">Ingredients</h2>
            <ul className="space-y-2.5">
              {selected.ingredients?.map((ing, i) => (
                <li key={i} className="text-body text-sm border-b border-edge pb-2.5">
                  {ing}
                </li>
              ))}
            </ul>
          </div>
          <div className="sm:col-span-2">
            <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-dim mb-4">Instructions</h2>
            <div className="space-y-4">
              {selected.instructions
                .split(/\r\n|\n|\r/)
                .filter(p => p.trim())
                .map((p, i) => (
                  <p key={i} className="text-sub text-sm leading-relaxed">{p.trim()}</p>
                ))}
            </div>
          </div>
        </div>

        <button
          onClick={() => deleteRecipe(selected.id)}
          className="mt-12 text-red-500 hover:text-red-400 text-sm transition-colors"
        >
          Delete this recipe
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-page px-6 pt-12 pb-24 max-w-6xl mx-auto">

      <div className="flex items-center justify-between mb-10">
        <div>
          <h1 className="text-3xl font-bold text-heading tracking-tight mb-2">My Recipes</h1>
          <p className="text-dim text-sm">
            {recipes.length === 0 ? "No custom recipes yet" : `${recipes.length} recipe${recipes.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-accent-solid hover:bg-accent-solid-hover text-on-accent font-semibold px-5 py-2.5 rounded-xl text-sm transition-colors"
        >
          {showForm ? "Cancel" : "+ New Recipe"}
        </button>
      </div>

      {showForm && (
        <div className="bg-card border border-edge rounded-2xl p-6 mb-10">
          <h2 className="text-heading font-semibold mb-6">New Recipe</h2>
          <div className="grid sm:grid-cols-2 gap-4">

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-sub mb-1.5 uppercase tracking-wider">Title *</label>
              <input
                name="title"
                value={form.title}
                onChange={handle}
                placeholder="My famous pasta..."
                className="w-full bg-page border border-edge rounded-lg px-4 py-3 text-heading placeholder-ghost focus:outline-none focus:border-accent transition-colors text-sm"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-sub mb-1.5 uppercase tracking-wider">Description</label>
              <input
                name="description"
                value={form.description}
                onChange={handle}
                placeholder="A short description..."
                className="w-full bg-page border border-edge rounded-lg px-4 py-3 text-heading placeholder-ghost focus:outline-none focus:border-accent transition-colors text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-sub mb-1.5 uppercase tracking-wider">Prep Time (minutes)</label>
              <input
                name="prepTime"
                type="number"
                value={form.prepTime}
                onChange={handle}
                placeholder="30"
                className="w-full bg-page border border-edge rounded-lg px-4 py-3 text-heading placeholder-ghost focus:outline-none focus:border-accent transition-colors text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-sub mb-1.5 uppercase tracking-wider">Servings</label>
              <input
                name="servings"
                type="number"
                value={form.servings}
                onChange={handle}
                placeholder="4"
                className="w-full bg-page border border-edge rounded-lg px-4 py-3 text-heading placeholder-ghost focus:outline-none focus:border-accent transition-colors text-sm"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-sub mb-1.5 uppercase tracking-wider">
                Ingredients * <span className="normal-case text-ghost font-normal">(one per line)</span>
              </label>
              <textarea
                name="ingredients"
                value={form.ingredients}
                onChange={handle}
                placeholder={"2 cups flour\n1 tsp salt\n3 eggs"}
                rows={5}
                className="w-full bg-page border border-edge rounded-lg px-4 py-3 text-heading placeholder-ghost focus:outline-none focus:border-accent transition-colors text-sm resize-none"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-sub mb-1.5 uppercase tracking-wider">Instructions *</label>
              <textarea
                name="instructions"
                value={form.instructions}
                onChange={handle}
                placeholder="Step by step instructions..."
                rows={6}
                className="w-full bg-page border border-edge rounded-lg px-4 py-3 text-heading placeholder-ghost focus:outline-none focus:border-accent transition-colors text-sm resize-none"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-sub mb-1.5 uppercase tracking-wider">
                Tags <span className="normal-case text-ghost font-normal">(comma separated)</span>
              </label>
              <input
                name="tags"
                value={form.tags}
                onChange={handle}
                placeholder="vegetarian, quick, italian"
                className="w-full bg-page border border-edge rounded-lg px-4 py-3 text-heading placeholder-ghost focus:outline-none focus:border-accent transition-colors text-sm"
              />
            </div>
          </div>

          <div className="flex justify-end mt-6">
            <button
              onClick={submit}
              disabled={saving}
              className="bg-accent-solid hover:bg-accent-solid-hover disabled:opacity-50 text-on-accent font-semibold px-6 py-2.5 rounded-xl text-sm transition-colors"
            >
              {saving ? "Saving..." : "Save Recipe"}
            </button>
          </div>
        </div>
      )}

      {recipes.length === 0 && !showForm ? (
        <div className="text-center py-24">
          <p className="text-ghost text-lg mb-2">No recipes yet</p>
          <p className="text-faint text-sm">Hit the button above to create your first one</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {recipes.map((recipe) => (
            <div
              key={recipe.id}
              onClick={() => setSelected(recipe)}
              className="group bg-card hover:bg-card-hover border border-edge hover:border-edge-hover rounded-2xl p-5 cursor-pointer transition-all"
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <h3 className="text-heading font-semibold leading-tight">{recipe.title}</h3>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteRecipe(recipe.id); }}
                  className="text-faint hover:text-red-400 transition-colors text-xs shrink-0 opacity-0 group-hover:opacity-100"
                >
                  ✕
                </button>
              </div>

              {recipe.description && (
                <p className="text-dim text-xs leading-relaxed mb-4 line-clamp-2">{recipe.description}</p>
              )}

              <div className="flex flex-wrap gap-1.5">
                {recipe.prepTime && (
                  <span className="px-2 py-1 bg-chip text-dim rounded-md text-xs">{recipe.prepTime}min</span>
                )}
                {recipe.servings && (
                  <span className="px-2 py-1 bg-chip text-dim rounded-md text-xs">{recipe.servings} servings</span>
                )}
                {recipe.tags?.slice(0, 2).map(tag => (
                  <span key={tag} className="px-2 py-1 bg-accent/10 text-accent rounded-md text-xs">{tag}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}