import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { mealdb } from "../services/mealdb";
import { useFavorites } from "../hooks/useFavorites";
import { useAuth } from "../context/AuthContext";
import toast from "react-hot-toast";

export default function RecipeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { addFavorite, removeFavorite, isFavorite } = useFavorites();
  const [meal, setMeal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [ingredients, setIngredients] = useState([]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const data = await mealdb.getById(id);
      setMeal(data);
      if (data) setIngredients(mealdb.parseIngredients(data));
      setLoading(false);
    };
    load();
  }, [id]);

  const handleFavorite = async () => {
    if (!user) {
      toast.error("Sign in to save favorites");
      navigate("/auth");
      return;
    }
    if (isFavorite(id)) {
      await removeFavorite(id);
      toast.success("Removed from favorites");
    } else {
      await addFavorite(meal);
      toast.success("Added to favorites");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-page px-6 pt-12 max-w-4xl mx-auto">
        <div className="h-8 w-32 bg-chip rounded animate-pulse mb-8" />
        <div className="h-80 bg-chip rounded-3xl animate-pulse mb-8" />
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-4 bg-chip rounded animate-pulse" style={{ width: `${80 - i * 8}%` }} />
          ))}
        </div>
      </div>
    );
  }

  if (!meal) {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center">
        <div className="text-center">
          <p className="text-sub text-lg mb-4">Recipe not found</p>
          <button onClick={() => navigate(-1)} className="text-accent text-sm hover:text-accent-hover">
            Go back
          </button>
        </div>
      </div>
    );
  }

  const favorited = isFavorite(id);

  return (
    <div className="min-h-screen bg-page pb-24">

      <div className="relative h-72 sm:h-96 w-full overflow-hidden">
        <img
          src={meal.strMealThumb}
          alt={meal.strMeal}
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-page via-page/40 to-transparent" />

        <button
          onClick={() => navigate(-1)}
          className="absolute top-6 left-6 bg-black/40 hover:bg-black/60 backdrop-blur-sm text-white rounded-full px-4 py-2 text-sm transition-colors"
        >
          Back
        </button>
      </div>

      <div className="max-w-3xl mx-auto px-6 -mt-12 relative">

        <div className="flex items-start justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold text-heading tracking-tight leading-tight mb-3">
              {meal.strMeal}
            </h1>
            <div className="flex flex-wrap gap-2">
              {meal.strCategory && (
                <span className="px-3 py-1 bg-accent/10 border border-accent/20 text-accent rounded-full text-xs font-medium">
                  {meal.strCategory}
                </span>
              )}
              {meal.strArea && (
                <span className="px-3 py-1 bg-chip border border-edge-hover text-sub rounded-full text-xs font-medium">
                  {meal.strArea}
                </span>
              )}
            </div>
          </div>

          <button
            onClick={handleFavorite}
            className={`shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-all ${
              favorited
                ? "bg-accent/10 border-accent/30 text-accent hover:bg-accent/20"
                : "bg-card border-edge text-sub hover:border-accent/30 hover:text-accent"
            }`}
          >
            <span>{favorited ? "♥" : "♡"}</span>
            <span>{favorited ? "Saved" : "Save"}</span>
          </button>
        </div>

        <div className="grid sm:grid-cols-3 gap-8">

          <div className="sm:col-span-1">
            <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-dim mb-4">
              Ingredients
            </h2>
            <ul className="space-y-2.5">
              {ingredients.map((item, i) => (
                <li key={i} className="flex justify-between gap-4 text-sm border-b border-edge pb-2.5">
                  <span className="text-body">{item.ingredient}</span>
                  <span className="text-dim text-right shrink-0">{item.measure}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="sm:col-span-2">
            <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-dim mb-4">
              Instructions
            </h2>
            <div className="space-y-4">
              {meal.strInstructions
                .split(/\r\n|\n|\r/)
                .filter((p) => p.trim().length > 0)
                .map((paragraph, i) => (
                  <p key={i} className="text-sub text-sm leading-relaxed">
                    {paragraph.trim()}
                  </p>
                ))}
            </div>

            <div className="flex gap-6 mt-8">
              {meal.strSource && (
                <a
                  href={meal.strSource}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:text-accent-hover text-sm transition-colors"
                >
                  View original recipe
                </a>
              )}
              {meal.strYoutube && (
                <a
                  href={meal.strYoutube}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-dim hover:text-body text-sm transition-colors"
                >
                  Watch on YouTube
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
