# encoding: UTF-8
require 'sketchup.rb'
require 'extensions.rb'
require 'fileutils'

# The first Plany-named installation retires the old loader and keeps its files
# outside SketchUp's Plugins directory for recovery. Existing model attributes
# and Ruby identifiers deliberately keep their original names.
module PlanyInstallationMigration
  def self.run
    plugins = File.dirname(__FILE__)
    old_loader = File.join(plugins, 'mydina.rb')
    old_source = File.join(plugins, 'mydina')
    if File.file?(old_loader) && File.directory?(old_source) &&
       File.read(old_loader, encoding: 'UTF-8').include?("'plany/main'") &&
       File.file?(File.join(old_source, 'main.rb'))
      backups = File.join(ENV.fetch('LOCALAPPDATA'), 'Plany', 'Backups')
      backup = File.join(backups, "legacy-install-#{Time.now.strftime('%Y%m%d-%H%M%S')}-#{Process.pid}")
      FileUtils.mkdir_p(backup)
      moved_source = moved_loader = false
      begin
        FileUtils.mv(old_source, File.join(backup, 'legacy_plugin'))
        moved_source = true
        FileUtils.mv(old_loader, File.join(backup, 'legacy_loader.rb'))
        moved_loader = true
      rescue StandardError
        FileUtils.mv(File.join(backup, 'legacy_loader.rb'), old_loader) if moved_loader
        FileUtils.mv(File.join(backup, 'legacy_plugin'), old_source) if moved_source
        raise
      end
    end

    old_data = File.join(ENV.fetch('LOCALAPPDATA'), 'MyDina')
    if File.directory?(old_data)
      target = File.join(ENV.fetch('LOCALAPPDATA'), 'Plany')
      FileUtils.mkdir_p(target)
      %w[Biblioteca Materiais].each do |name|
        previous = File.join(old_data, name)
        next unless File.directory?(previous)
        destination = File.join(target, name)
        if File.exist?(destination)
          warn "[Plany] Dados antigos preservados para conferência: #{previous}"
        else
          FileUtils.mv(previous, destination)
        end
      end
      Dir.rmdir(old_data) if Dir.empty?(old_data)
    end
  rescue StandardError => error
    warn "[Plany] Migração da instalação anterior incompleta: #{error.message}"
  end
end

PlanyInstallationMigration.run

module RQMyDina
  unless file_loaded?(__FILE__)
    extension = SketchupExtension.new('Plany — Módulos', 'plany/main')
    extension.description = 'Caixarias, portas, gavetas, biblioteca, lista de peças e plano de corte.'
    extension.version = '0.6.170'
    extension.creator = 'Plany'
    extension.copyright = '2026 Plany'
    missing = %w[main.rb reloader.rb release_updater.rb trial_access.rb trial_check.ps1].reject do |name|
      File.file?(File.join(__dir__, 'plany', name))
    end
    Sketchup.register_extension(extension, missing.empty?)
    unless missing.empty?
      warn "[Plany] Instalação incompleta: #{missing.join(', ')}"
      UI.messagebox('A instalação do Plany está incompleta. Reinstale o RBZ completo pelo Gerenciador de Extensões e feche e reabra o SketchUp. Seus projetos e itens já salvos na Biblioteca serão mantidos.')
    end
    file_loaded(__FILE__)
  end
end
