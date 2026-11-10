class UsersController < ApplicationController
  include Pageable

  def index
    render inertia: 'users/index', props: { users: User.all, per_page: Pageable::PER_PAGE }
  end

  def show
    render inertia: { user: User.find(params[:id]) }
  end

  def edit
    render inertia: 'users/gone'
  end

  def export
    # String is Ruby's own class, even though lib/core_ext/string.rb reopens it
    render plain: String.new(Billing::Charge.new(nil).call.to_s)
  end
end
