Rails.application.routes.draw do
  resources :users
  inertia 'dashboard' => 'Dashboard/Index'
  inertia 'missing' => 'Nowhere'
end
