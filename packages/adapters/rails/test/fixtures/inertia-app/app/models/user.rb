class User < ApplicationRecord
  has_many :oauth_tokens
  has_many :criteria
  has_many :invoices, class_name: 'Billing::Invoice'
  has_many :taggings
  belongs_to :owner, polymorphic: true
end
