import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { mealdb } from "../services/mealdb";

export default function Search() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const q = searchParams.get("q");
    const category = searchParams.get("category");

    if (q) {
      setQuery(q);
      doSearch(q);
    } else if (category) {
      doCategory(category);
    }
  }, [searchParams]);

  const doSearch = async (q) => {
    setLoading(true);
    setSearched(true);
    const meals = await mealdb.search(q);
    setResults(meals);
    setLoading(false);
  };

  const doCategory = async (category) => {
    setLoading(true);
    setSearched(true);
    const meals = await mealdb.getByCategory(category);
    setResults(meals);
    setLoading(false);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (query.trim()) setSearchParams({ q: query.trim() });
  };

  return (
    <div className="min-h-screen bg-page px-6 pt-12 pb-24 max-w-6xl mx-auto">

      <form onSubmit={handleSubmit} className="flex gap-3 mb-10 max-w-xl mx-auto">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search any dish..."
          className="flex-1 bg-card border border-edge rounded-xl px-5 py-3 text-heading placeholder-ghost focus:outline-none focus:border-accent transition-colors text-sm"
        />
        <button
          type="submit"
          className="bg-accent-solid hover:bg-accent-solid-hover text-on-accent font-semibold px-6 py-3 rounded-xl transition-colors text-sm"
        >
          Search
        </button>
      </form>

      {searched && !loading && (
        <p className="text-dim text-xs uppercase tracking-widest mb-6">
          {results.length} result{results.length !== 1 ? "s" : ""} found
        </p>
      )}

      {loading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-chip rounded-2xl aspect-square animate-pulse" />
          ))}
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {results.map((meal) => (
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

      {!loading && searched && results.length === 0 && (
        <div className="text-center py-24">
          <p className="text-ghost text-lg mb-2">No recipes found</p>
          <p className="text-faint text-sm">Try a different search term</p>
        </div>
      )}

      {!searched && !loading && (
        <div className="text-center py-24">
          <p className="text-ghost text-lg">Search for a recipe above</p>
        </div>
      )}
    </div>
  );
}