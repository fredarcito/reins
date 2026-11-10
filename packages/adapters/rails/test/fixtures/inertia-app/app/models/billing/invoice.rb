module Billing
  class Invoice < ApplicationRecord
    STATUSES = %w[draft paid].freeze
    belongs_to :user
    has_many :line_items
  end
end
