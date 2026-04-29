import { useNavigate } from "react-router-dom";
import { useFavorites } from "../hooks/useFavorites";
import { useAuth } from "../context/AuthContext";

export default function Favorites() {
  const { user } = useAuth();
  const { favorites, removeFavorite } = useFavorites();
  const navigate = useNavigate();

  if (!user) {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center">
        <div className="text-center">
          <p className="text-sub text-lg mb-4">Sign in to view your favorites</p>
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

  return (
    <div className="min-h-screen bg-page px-6 pt-12 pb-24 max-w-6xl mx-auto">

      <div className="mb-10">
        <h1 className="text-3xl font-bold text-heading tracking-tight mb-2">Favorites</h1>
        <p className="text-dim text-sm">
          {favorites.length === 0
            ? "No saved recipes yet"
            : `${favorites.length} saved recipe${favorites.length !== 1 ? "s" : ""}`}
        </p>
      </div>

      {favorites.length === 0 ? (
        <div className="text-center py-24">
          <p className="text-ghost text-lg mb-2">Nothing here yet</p>
          <p className="text-faint text-sm mb-8">Browse recipes and hit Save to build your collection</p>
          <button
            onClick={() => navigate("/search")}
            className="bg-accent-solid hover:bg-accent-solid-hover text-on-accent font-semibold px-6 py-2.5 rounded-xl text-sm transition-colors"
          >
            Explore recipes
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {favorites.map((fav) => (
            <div key={fav.recipeId} className="group relative rounded-2xl overflow-hidden aspect-square">
              <img
                src={fav.image}
                alt={fav.title}
                onClick={() => navigate(`/recipe/${fav.recipeId}`)}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 cursor-pointer"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none" />

              <button
                onClick={() => removeFavorite(fav.recipeId)}
                className="absolute top-3 right-3 bg-black/50 hover:bg-red-500/80 backdrop-blur-sm text-white rounded-full w-8 h-8 flex items-center justify-center text-xs transition-colors opacity-0 group-hover:opacity-100"
              >
                ✕
              </button>

              <div
                onClick={() => navigate(`/recipe/${fav.recipeId}`)}
                className="absolute bottom-0 left-0 right-0 p-4 cursor-pointer"
              >
                <p className="text-white font-semibold text-sm leading-tight line-clamp-2">
                  {fav.title}
                </p>
                {fav.category && (
                  <p className="text-accent text-xs mt-1">{fav.category}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}