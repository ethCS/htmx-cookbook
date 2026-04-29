import { Routes, Route } from "react-router-dom";
import Layout from "./components/layout/Layout";
import Home from "./pages/Home";
import Search from "./pages/Search";
import RecipeDetail from "./pages/RecipeDetail";
import Favorites from "./pages/Favorites";
import MyRecipes from "./pages/MyRecipes";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="search" element={<Search />} />
        <Route path="recipe/:id" element={<RecipeDetail />} />
        <Route path="favorites" element={<Favorites />} />
        <Route path="my-recipes" element={<MyRecipes />} />
        <Route path="auth" element={<Auth />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}