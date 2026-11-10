require_relative 'boot'
require 'rails'
require 'core_ext/string'

module Shop
  class Application < Rails::Application
    config.autoload_lib(ignore: %w[tasks])
  end
end
