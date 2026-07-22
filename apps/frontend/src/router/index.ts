import { createRouter, createWebHistory } from "vue-router";
import Home from "../views/Home.vue";
import Chat from "../views/Chat.vue";
import Login from "../views/Login.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "home",
      component: Home,
    },
    {
      path: "/chat",
      name: "chat",
      component: Chat,
    },
    {
      path: "/login",
      name: "login",
      component: Login,
    },
  ],
});

router.beforeEach((to) => {
  if (to.name === "login") return;

  const token = (() => {
    try {
      return localStorage.getItem("auth_token");
    } catch {
      return null;
    }
  })();

  if (!token) {
    return { name: "login" };
  }
});
