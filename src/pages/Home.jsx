import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { mealdb } from "../services/mealdb";

export default function Home() {
  const [query, setQuery] = useState("");
  const [featured, setFeatured] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const loadFeatured = async () => {
    setLoading(true);
    const [meals, cats] = await Promise.all([
      mealdb.getRandomMultiple(8),
      mealdb.getCategories(),
    ]);
    setFeatured(meals);
    setCategories(cats.slice(0, 10));
    setLoading(false);
  };

  useEffect(() => { loadFeatured(); }, []);

  const refreshFeatured = () => {
    mealdb.invalidateRandom();
    loadFeatured();
  };

  const handleSearch = (e) => {
    e.preventDefault();
    if (query.trim()) navigate(`/search?q=${encodeURIComponent(query.trim())}`);
  };

  return (
    <div className="min-h-screen bg-page">

      <section className="relative px-6 pt-24 pb-20 text-center overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-accent-dark/40 via-page to-page pointer-events-none" />
        <div className="relative max-w-2xl mx-auto">
          <p className="text-accent text-xs font-semibold uppercase tracking-[0.2em] mb-4">
            Your personal cookbook
          </p>
          <h1 className="text-5xl sm:text-6xl font-bold text-heading tracking-tight leading-tight mb-6">
            Cook something<br />
            <span className="text-accent">worth remembering.</span>
          </h1>
          <p className="text-sub text-lg mb-10 leading-relaxed">
            Discover thousands of recipes, save your favorites, and build your own collection.
          </p>

          <form onSubmit={handleSearch} className="flex gap-3 max-w-lg mx-auto">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search any dish, ingredient..."
              className="flex-1 bg-card border border-edge rounded-xl px-5 py-3.5 text-heading placeholder-ghost focus:outline-none focus:border-accent transition-colors text-sm"
            />
            <button
              type="submit"
              className="bg-accent-solid hover:bg-accent-solid-hover text-on-accent font-semibold px-6 py-3.5 rounded-xl transition-colors text-sm whitespace-nowrap"
            >
              Search
            </button>
          </form>
        </div>
      </section>

      <section className="px-6 pb-16 max-w-6xl mx-auto">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-dim mb-5">
          Browse by category
        </h2>
        <div className="flex gap-3 flex-wrap">
          {categories.map((cat) => (
            <button
              key={cat.idCategory}
              onClick={() => navigate(`/search?category=${encodeURIComponent(cat.strCategory)}`)}
              className="px-4 py-2 bg-card hover:bg-card-hover border border-edge hover:border-edge-hover rounded-full text-sm text-body transition-colors"
            >
              {cat.strCategory}
            </button>
          ))}
        </div>
      </section>

      <section className="px-6 pb-24 max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-dim">
            Discover recipes
          </h2>
          <button
            onClick={refreshFeatured}
            disabled={loading}
            className="text-ghost hover:text-accent transition-colors disabled:opacity-30"
          >
            <RefreshCw size={14} />
          </button>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-chip rounded-2xl aspect-square animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {featured.map((meal) => (
              <button
                key={meal.idMeal}
                onClick={() => navigate(`/recipe/${meal.idMeal}`)}
                className="group relative rounded-2xl overflow-hidden aspect-square text-left focus:outline-none"
              >
                <img
                  src={meal.strMealThumb}
                  alt={meal.strMeal}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-4">
                  <p className="text-white font-semibold text-sm leading-tight line-clamp-2">
                    {meal.strMeal}
                  </p>
                  {meal.strCategory && (
                    <p className="text-accent text-xs mt-1">{meal.strCategory}</p>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}